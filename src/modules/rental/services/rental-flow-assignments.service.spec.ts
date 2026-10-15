import type { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import type { Repository } from 'typeorm'
import { NotFoundException } from '@nestjs/common'
import { RentalFlowAssignmentsService } from './rental-flow-assignments.service'
import { SAFE_DEFAULT_FLOW_PROFILE_ID } from '../utils/default-flow-profile'
import type { RentalFlowConfig } from '../schemas/rental-flow-config.schema'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'

interface MockConfigRepo {
  findOne: jest.Mock
  find: jest.Mock
  create: jest.Mock
  save: jest.Mock
}

interface MockAuditRepo {
  create: jest.Mock
  save: jest.Mock
  find: jest.Mock
}

describe('RentalFlowAssignmentsService', () => {
  let service: RentalFlowAssignmentsService
  let mockConfigRepo: MockConfigRepo
  let mockAuditRepo: MockAuditRepo

  beforeEach(() => {
    mockConfigRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto: Record<string, unknown>) => ({ ...dto })),
      save: jest.fn((entity: Record<string, unknown>) =>
        Promise.resolve({ _id: 'asgn-mongo-id', ...entity })
      ),
    }

    mockAuditRepo = {
      find: jest.fn(),
      create: jest.fn((dto: Record<string, unknown>) => ({ ...dto })),
      save: jest.fn((entity: Record<string, unknown>) =>
        Promise.resolve(entity)
      ),
    }

    service = new RentalFlowAssignmentsService(
      mockConfigRepo as unknown as Repository<RentalFlowConfig>,
      new ConfigAuditService(
        mockAuditRepo as unknown as Repository<ActivityLog>
      )
    )
  })

  it('ensures active global seed assignment exists on module init, filtering kind assignment and profile separately', async () => {
    mockConfigRepo.findOne.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          where.kind === 'profile'
            ? {
                kind: 'profile',
                key: SAFE_DEFAULT_FLOW_PROFILE_ID,
                version: 1,
                contentHash: 'hash-v1',
              }
            : null
        )
    )

    const seeded = await service.ensureGlobalSeedAssignment()

    const findOneArgs: unknown[] = mockConfigRepo.findOne.mock.calls.map(
      (call: unknown[]) => call[0]
    )
    expect(findOneArgs[0]).toEqual({
      where: { kind: 'assignment', scope: 'GLOBAL', supersededAt: null },
    })
    expect(findOneArgs[1]).toEqual({
      where: {
        kind: 'profile',
        key: SAFE_DEFAULT_FLOW_PROFILE_ID,
        status: 'published',
        version: 1,
      },
    })
    expect(mockConfigRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'assignment',
        key: 'asgn-global-seed',
        scope: 'GLOBAL',
        profileRef: {
          profileId: SAFE_DEFAULT_FLOW_PROFILE_ID,
          version: 1,
          contentHash: 'hash-v1',
        },
      })
    )
    expect(seeded).toMatchObject({
      assignmentId: 'asgn-global-seed',
      scope: 'GLOBAL',
    })
    expect(seeded).not.toHaveProperty('kind')
    expect(seeded).not.toHaveProperty('key')
  })

  it('throws NotFoundException when activating assignment for non-existent profile', async () => {
    mockConfigRepo.findOne.mockResolvedValue(null)

    await expect(
      service.activateAssignment(
        {
          scope: 'DURATION',
          scopeValue: '12',
          profileId: 'prof-ghost',
          version: 1,
        },
        'admin-1'
      )
    ).rejects.toThrow(NotFoundException)

    expect(mockConfigRepo.findOne).toHaveBeenCalledWith({
      where: {
        kind: 'profile',
        key: 'prof-ghost',
        status: 'published',
        version: 1,
      },
    })
  })

  it('supersedes previous active assignment of identical scope (kind assignment) when activating new one', async () => {
    const existingActive = {
      kind: 'assignment',
      key: 'asgn-old-1',
      scope: 'DURATION',
      scopeValue: '12',
      supersededAt: null,
      profileRef: {
        profileId: 'prof-old',
        version: 1,
        contentHash: 'hash-old',
      },
    }

    mockConfigRepo.findOne.mockResolvedValue({
      kind: 'profile',
      key: 'prof-vip',
      version: 2,
      contentHash: 'hash-v2',
    })
    mockConfigRepo.find.mockResolvedValue([existingActive])

    const activated = await service.activateAssignment(
      {
        scope: 'DURATION',
        scopeValue: '12',
        profileId: 'prof-vip',
        version: 2,
      },
      'admin-1'
    )

    expect(mockConfigRepo.find).toHaveBeenCalledWith({
      where: {
        kind: 'assignment',
        scope: 'DURATION',
        scopeValue: '12',
        supersededAt: null,
      },
    })
    expect(existingActive.supersededAt).toBeInstanceOf(Date)
    expect(mockConfigRepo.save).toHaveBeenCalledWith(existingActive)
    expect(mockAuditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'config-audit',
        action: 'ASSIGNMENT_SUPERSEDED',
        actorId: 'admin-1',
        scope: 'rental-flow',
        targetType: 'assignment',
        key: 'asgn-old-1',
        version: 1,
      })
    )
    expect(mockAuditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'config-audit',
        action: 'ASSIGNMENT_ACTIVATED',
        targetType: 'assignment',
        version: 2,
      })
    )
    expect(activated.scope).toBe('DURATION')
    expect(activated).not.toHaveProperty('kind')
  })

  it('finds the previously active assignment with a plain supersededAt: null filter (Mongo matches unset rows)', async () => {
    mockConfigRepo.findOne.mockResolvedValue({
      kind: 'profile',
      key: 'prof-vip',
      version: 2,
      contentHash: 'hash-v2',
    })
    mockConfigRepo.find.mockResolvedValue([])

    await service.activateAssignment(
      {
        scope: 'DURATION',
        scopeValue: '12',
        profileId: 'prof-vip',
        version: 2,
      },
      'admin-1'
    )

    const [call] = mockConfigRepo.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ]
    const { where } = call
    expect(where).toEqual({
      kind: 'assignment',
      scope: 'DURATION',
      scopeValue: '12',
      supersededAt: null,
    })
  })

  it('lists assignments only (kind assignment) newest first, in the legacy JSON shape without kind/key', async () => {
    const createdAt = new Date(Date.UTC(2026, 1, 2))
    mockConfigRepo.find.mockResolvedValue([
      {
        _id: 'asgn-id-1',
        kind: 'assignment',
        key: 'asgn-1',
        scope: 'GLOBAL',
        scopeValue: null,
        profileRef: { profileId: 'prof-1', version: 1, contentHash: 'h' },
        effectiveAt: createdAt,
        supersededAt: null,
        createdBy: 'system',
        createdAt,
        updatedAt: createdAt,
      },
    ])

    const list = await service.listAssignments()

    expect(mockConfigRepo.find).toHaveBeenCalledWith({
      where: { kind: 'assignment' },
      order: { createdAt: 'DESC' },
    })
    expect(JSON.parse(JSON.stringify(list))).toEqual([
      {
        _id: 'asgn-id-1',
        assignmentId: 'asgn-1',
        scope: 'GLOBAL',
        scopeValue: null,
        profileRef: { profileId: 'prof-1', version: 1, contentHash: 'h' },
        effectiveAt: createdAt.toISOString(),
        supersededAt: null,
        createdBy: 'system',
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      },
    ])
  })

  it('lists the 100 newest rental-flow audits only, newest first, in the legacy JSON shape', async () => {
    const day = (n: number): Date => new Date(Date.UTC(2026, 1, n))
    const stored = [
      {
        scope: 'rental-flow',
        key: 'asgn-1',
        action: 'ASSIGNMENT_ACTIVATED',
        actorId: 'admin-1',
        targetType: 'assignment',
        version: 2,
        details: { scope: 'GLOBAL' },
        createdAt: day(1),
      },
      {
        scope: 'contract-template',
        key: 'VN_RE',
        action: 'published',
        actorId: 'admin-2',
        version: 1,
        createdAt: day(5),
      },
      {
        scope: 'rental-flow',
        key: 'prof-1',
        action: 'PROFILE_PUBLISHED',
        actorId: 'admin-3',
        targetType: 'profile',
        version: 3,
        details: null,
        createdAt: day(3),
      },
    ]
    mockAuditRepo.find.mockImplementation(
      (opts: {
        where: { scope: string }
        order: { createdAt: 'ASC' | 'DESC' }
        take: number
      }) =>
        Promise.resolve(
          stored
            .filter(row => row.scope === opts.where.scope)
            .sort((x, y) =>
              opts.order.createdAt === 'DESC'
                ? y.createdAt.getTime() - x.createdAt.getTime()
                : x.createdAt.getTime() - y.createdAt.getTime()
            )
            .slice(0, opts.take)
        )
    )

    const result = await service.getAudits()

    expect(mockAuditRepo.find).toHaveBeenCalledTimes(1)
    expect(mockAuditRepo.find).toHaveBeenCalledWith({
      where: { kind: 'config-audit', scope: 'rental-flow' },
      order: { createdAt: 'DESC' },
      take: 100,
    })
    expect(JSON.parse(JSON.stringify(result))).toEqual([
      {
        action: 'PROFILE_PUBLISHED',
        actorId: 'admin-3',
        targetType: 'profile',
        targetId: 'prof-1',
        version: 3,
        details: null,
        createdAt: day(3).toISOString(),
      },
      {
        action: 'ASSIGNMENT_ACTIVATED',
        actorId: 'admin-1',
        targetType: 'assignment',
        targetId: 'asgn-1',
        version: 2,
        details: { scope: 'GLOBAL' },
        createdAt: day(1).toISOString(),
      },
    ])
  })
})
