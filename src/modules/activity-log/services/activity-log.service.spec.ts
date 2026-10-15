import type { Repository } from 'typeorm'
import type { ActivityLog } from '../schemas/activity-log.schema'
import {
  ActivityLogService,
  redactSensitive,
  type CreateActivityLogInput,
} from './activity-log.service'

interface MockRepo {
  create: jest.Mock
  save: jest.Mock
  findAndCount: jest.Mock
}

function mockRepo(): MockRepo {
  return {
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
  }
}

const INPUT: CreateActivityLogInput = {
  userId: 'u1',
  userRole: 'admin',
  method: 'POST',
  path: '/api/v1/groq-keys/admin',
  action: 'Thêm Groq key',
  statusCode: 201,
}

describe('ActivityLogService', () => {
  let repo: MockRepo
  let service: ActivityLogService

  beforeEach(() => {
    repo = mockRepo()
    service = new ActivityLogService(repo as unknown as Repository<ActivityLog>)
  })

  it('redacts sensitive fields recursively', () => {
    expect(
      redactSensitive({
        name: 'a',
        Password: 'x',
        nested: { token: 't', list: [{ pin: '1', ok: 1 }] },
      })
    ).toEqual({
      name: 'a',
      Password: '[REDACTED]',
      nested: { token: '[REDACTED]', list: [{ pin: '[REDACTED]', ok: 1 }] },
    })
  })

  it('saves the entry with a redacted request body', async () => {
    await service.create({
      ...INPUT,
      requestBody: { keys: 'k', password: 'secret' },
    })

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        requestBody: { keys: 'k', password: '[REDACTED]' },
      })
    )
  })

  it('rethrows when saving fails', async () => {
    repo.save.mockRejectedValueOnce(new Error('db down'))
    await expect(service.create(INPUT)).rejects.toThrow('db down')
  })

  it('paginates newest first and echoes page info', async () => {
    repo.findAndCount.mockResolvedValueOnce([[{ userId: 'u1' }], 41])

    const result = await service.findAll(3, 20)

    expect(repo.findAndCount).toHaveBeenCalledWith({
      where: { kind: 'http' },
      order: { createdAt: 'DESC' },
      skip: 40,
      take: 20,
    })
    expect(result).toEqual({
      logs: [{ userId: 'u1' }],
      total: 41,
      page: 3,
      limit: 20,
    })
  })

  it('asks only for http rows and strips kind and foreign columns from the page', async () => {
    repo.findAndCount.mockResolvedValueOnce([
      [
        { userId: 'u1', kind: 'http', method: 'POST', path: '/p' },
        { kind: 'job-run', jobName: 'rental-ops', userId: 'ignored' },
      ],
      2,
    ])

    const result = await service.findAll(1, 20)

    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: 'http' } })
    )
    expect(result.logs).toEqual([
      { userId: 'u1', method: 'POST', path: '/p' },
      { userId: 'ignored' },
    ])
    expect(result.logs[0]).not.toHaveProperty('kind')
  })

  it('filters by user and clamps invalid paging', async () => {
    await service.findByUser('u9', 0, 5000)

    expect(repo.findAndCount).toHaveBeenCalledWith({
      where: { userId: 'u9', kind: 'http' },
      order: { createdAt: 'DESC' },
      skip: 0,
      take: 100,
    })
  })
})
