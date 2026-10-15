import { NotFoundException } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { ObjectId } from 'mongodb'
import { BaseJob } from '../base-job'
import { JobManagerService } from './job-manager.service'

class FakeJob extends BaseJob {
  readonly description = 'fake'
  readonly cron = '0 7 * * *'
  readonly timeZone = 'Asia/Ho_Chi_Minh'
  run = jest.fn().mockResolvedValue(3)
  constructor(readonly name: string) {
    super()
  }
}

type ConfigRow = { scope: string; key: string; enabled: boolean }
type Repos = {
  configs: Map<string, ConfigRow>
  histories: Array<Record<string, unknown>>
  configRepo: Record<'findOne' | 'create' | 'save', jest.Mock>
  historyRepo: Record<'create' | 'save' | 'find', jest.Mock>
}

function makeRepos(): Repos {
  const configs = new Map<string, ConfigRow>()
  const histories: Array<Record<string, unknown>> = []
  const configRepo = {
    findOne: jest.fn(({ where }: { where: { scope: string; key: string } }) =>
      // Mọi truy vấn cấu hình job phải lọc scope 'job'.
      Promise.resolve(
        where.scope === 'job' ? (configs.get(where.key) ?? null) : null
      )
    ),
    create: jest.fn((v: ConfigRow) => v),
    save: jest.fn((v: ConfigRow) => {
      configs.set(v.key, v)
      return Promise.resolve(v)
    }),
  }
  const historyRepo = {
    create: jest.fn((v: Record<string, unknown>) => ({ ...v })),
    save: jest.fn((v: Record<string, unknown>) => {
      // Upsert theo _id như TypeORM: ghi lần hai cùng bản ghi cập nhật dòng đã có.
      if (v._id === undefined) v._id = new ObjectId()
      const index = histories.findIndex(h => String(h._id) === String(v._id))
      if (index >= 0) histories[index] = { ...v }
      else histories.push({ ...v })
      return Promise.resolve({ ...v })
    }),
    find: jest.fn(() => Promise.resolve(histories)),
  }
  return { configs, histories, configRepo, historyRepo }
}

function build(
  jobs: BaseJob[],
  repos = makeRepos()
): { manager: JobManagerService; registry: SchedulerRegistry } & Repos {
  const registry = new SchedulerRegistry()
  const manager = new JobManagerService(
    jobs,
    registry,
    repos.configRepo as never,
    repos.historyRepo as never
  )
  return { manager, registry, ...repos }
}

describe('JobManagerService', () => {
  const managers: JobManagerService[] = []
  const make = (jobs: BaseJob[], repos?: Repos): ReturnType<typeof build> => {
    const built = build(jobs, repos)
    managers.push(built.manager)
    return built
  }
  afterEach(() => {
    managers.splice(0).forEach(m => m.onModuleDestroy())
  })

  it('registers every job in the scheduler registry, enabled by default', async () => {
    const { manager, registry, configs } = make([
      new FakeJob('job-a'),
      new FakeJob('job-b'),
    ])

    await manager.onModuleInit()

    expect(registry.doesExist('cron', 'job-a')).toBe(true)
    expect(registry.doesExist('cron', 'job-b')).toBe(true)
    expect(registry.getCronJob('job-a').isActive).toBe(true)
    expect(manager.list().map(j => [j.name, j.enabled, j.scheduled])).toEqual([
      ['job-a', true, true],
      ['job-b', true, true],
    ])
    expect(configs.get('job-a')).toMatchObject({
      scope: 'job',
      key: 'job-a',
      enabled: true,
    })
    expect(manager.list()[0]?.timeZone).toBe('Asia/Ho_Chi_Minh')
  })

  it('treats a config read failure as enabled so the job still runs', async () => {
    const repos = makeRepos()
    repos.configRepo.findOne.mockRejectedValue(new Error('db down'))
    const { manager, registry } = make([new FakeJob('job-a')], repos)

    await manager.onModuleInit()

    expect(manager.isEnabled('job-a')).toBe(true)
    expect(registry.getCronJob('job-a').isActive).toBe(true)
  })

  it('does not start the schedule of a job disabled in config', async () => {
    const repos = makeRepos()
    repos.configs.set('job-a', {
      scope: 'job',
      key: 'job-a',
      enabled: false,
    })
    const { manager, registry } = make([new FakeJob('job-a')], repos)

    await manager.onModuleInit()

    expect(manager.list()[0]).toMatchObject({
      enabled: false,
      scheduled: false,
    })
    expect(registry.getCronJob('job-a').isActive).toBe(false)
  })

  it('disables and re-enables a job and persists the flag', async () => {
    const { manager, registry, configs } = make([new FakeJob('job-a')])
    await manager.onModuleInit()

    const disabled = await manager.disable('job-a')
    expect(disabled).toMatchObject({ enabled: false, scheduled: false })
    expect(configs.get('job-a')?.enabled).toBe(false)
    expect(registry.getCronJob('job-a').isActive).toBe(false)

    const enabled = await manager.enable('job-a')
    expect(enabled).toMatchObject({ enabled: true, scheduled: true })
    expect(configs.get('job-a')?.enabled).toBe(true)
  })

  it('runs a job manually, even when disabled, and records start/finish history', async () => {
    const job = new FakeJob('job-a')
    const { manager, histories } = make([job])
    await manager.onModuleInit()
    await manager.disable('job-a')

    const outcome = await manager.runNow('job-a')

    expect(job.run).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({
      jobName: 'job-a',
      trigger: 'manual',
      status: 'success',
      result: 3,
      error: null,
    })
    expect(histories).toHaveLength(1)
    expect(histories[0]).toMatchObject({
      jobName: 'job-a',
      trigger: 'manual',
      status: 'success',
      result: 3,
    })
    expect(histories[0]?.finishedAt).toBeInstanceOf(Date)
    expect(typeof histories[0]?.durationMs).toBe('number')
  })

  it('records the error without throwing when a job fails', async () => {
    const job = new FakeJob('job-a')
    job.run.mockRejectedValue(new Error('boom'))
    const { manager, histories } = make([job])
    await manager.onModuleInit()

    const outcome = await manager.runNow('job-a')

    expect(outcome).toMatchObject({ status: 'error', error: 'boom' })
    expect(histories[0]).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('still runs the job when history persistence fails', async () => {
    const repos = makeRepos()
    repos.historyRepo.save.mockRejectedValue(new Error('db down'))
    const job = new FakeJob('job-a')
    const { manager } = make([job], repos)
    await manager.onModuleInit()

    await expect(manager.runNow('job-a')).resolves.toMatchObject({
      status: 'success',
    })
    expect(job.run).toHaveBeenCalledTimes(1)
  })

  it('returns history for a known job and rejects unknown jobs', async () => {
    const { manager, historyRepo } = make([new FakeJob('job-a')])
    await manager.onModuleInit()

    await manager.history('job-a', 5)
    expect(historyRepo.find).toHaveBeenCalledWith({
      where: { jobName: 'job-a', kind: 'job-run' },
      order: { startedAt: 'DESC' },
      take: 5,
    })
    await expect(manager.runNow('nope')).rejects.toBeInstanceOf(
      NotFoundException
    )
    await expect(manager.enable('nope')).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('rejects duplicate job names', () => {
    expect(() => build([new FakeJob('x'), new FakeJob('x')])).toThrow(
      /Duplicate job name/
    )
  })
})
