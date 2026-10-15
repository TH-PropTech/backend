import type { Repository } from 'typeorm'
import type { ActivityLog } from '../schemas/activity-log.schema'
import type { ConfigAuditScope } from '../schemas/config-audit.schema'
import { ConfigAuditService } from './config-audit.service'

type Where = {
  kind: string
  scope: ConfigAuditScope
  key?: string
  version?: number
}

describe('ConfigAuditService', () => {
  const day = (n: number): Date => new Date(Date.UTC(2026, 0, n))
  const rows = [
    {
      kind: 'config-audit',
      scope: 'contract-template',
      key: 'K1',
      version: 1,
      createdAt: day(3),
    },
    {
      kind: 'config-audit',
      scope: 'contract-template',
      key: 'K1',
      version: 2,
      createdAt: day(1),
    },
    {
      kind: 'config-audit',
      scope: 'contract-layout',
      key: 'K1',
      version: 1,
      createdAt: day(2),
    },
    {
      kind: 'config-audit',
      scope: 'rental-flow',
      key: 'K1',
      createdAt: day(4),
    },
    {
      kind: 'config-audit',
      scope: 'platform-fee',
      key: 'K1',
      version: 1,
      createdAt: day(5),
    },
    // Dòng của loại khác có cùng scope/key: không được lẫn vào kết quả.
    {
      kind: 'http',
      scope: 'contract-template',
      key: 'K1',
      version: 1,
      createdAt: day(6),
    },
  ] as unknown as ActivityLog[]

  function build(): {
    service: ConfigAuditService
    repo: { find: jest.Mock; create: jest.Mock; save: jest.Mock }
  } {
    const repo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
      find: jest.fn(
        (opts: {
          where: Where
          order: { createdAt: 'ASC' | 'DESC' }
          take?: number
        }) => {
          const sorted = rows
            .filter(
              r =>
                r.kind === opts.where.kind &&
                r.scope === opts.where.scope &&
                (opts.where.key === undefined || r.key === opts.where.key) &&
                (opts.where.version === undefined ||
                  r.version === opts.where.version)
            )
            .sort((a, b) =>
              opts.order.createdAt === 'ASC'
                ? a.createdAt.getTime() - b.createdAt.getTime()
                : b.createdAt.getTime() - a.createdAt.getTime()
            )
          return Promise.resolve(sorted.slice(0, opts.take))
        }
      ),
    }
    return {
      service: new ConfigAuditService(
        repo as unknown as Repository<ActivityLog>
      ),
      repo,
    }
  }

  it('findByKey filters by kind, scope and key, oldest first, ignoring other scopes and kinds', async () => {
    const { service, repo } = build()

    const result = await service.findByKey('contract-template', 'K1')

    expect(repo.find).toHaveBeenCalledWith({
      where: { kind: 'config-audit', scope: 'contract-template', key: 'K1' },
      order: { createdAt: 'ASC' },
    })
    expect(result.map(r => r.version)).toEqual([2, 1])
  })

  it('findByKey narrows by a truthy version only', async () => {
    const { service, repo } = build()

    await service.findByKey('contract-template', 'K1', 2)
    expect(repo.find).toHaveBeenLastCalledWith({
      where: {
        kind: 'config-audit',
        scope: 'contract-template',
        key: 'K1',
        version: 2,
      },
      order: { createdAt: 'ASC' },
    })

    await service.findByKey('contract-template', 'K1', 0)
    expect(repo.find).toHaveBeenLastCalledWith({
      where: { kind: 'config-audit', scope: 'contract-template', key: 'K1' },
      order: { createdAt: 'ASC' },
    })
  })

  it('findRecent returns the newest rows of one scope with the default limit of 100', async () => {
    const { service, repo } = build()

    const result = await service.findRecent('rental-flow')

    expect(repo.find).toHaveBeenCalledWith({
      where: { kind: 'config-audit', scope: 'rental-flow' },
      order: { createdAt: 'DESC' },
      take: 100,
    })
    expect(result.every(r => r.scope === 'rental-flow')).toBe(true)
  })

  it('returns the legacy ConfigAudit shape: no kind, no updatedAt', async () => {
    const { service, repo } = build()
    repo.find.mockResolvedValueOnce([
      {
        _id: 'x',
        kind: 'config-audit',
        scope: 'platform-fee',
        key: 'fee-1',
        version: 1,
        action: 'published',
        actorId: 'admin-1',
        updatedAt: new Date(0),
        createdAt: day(1),
      },
    ])

    const [row] = await service.findRecent('platform-fee')

    expect(row).not.toHaveProperty('kind')
    expect(row).not.toHaveProperty('updatedAt')
    expect(row).toMatchObject({ scope: 'platform-fee', key: 'fee-1' })
  })

  it('append saves a new row stamped with kind config-audit and exposes no update or delete operation', async () => {
    const { service, repo } = build()

    await service.append({
      scope: 'platform-fee',
      key: 'fee-1',
      version: 1,
      action: 'published',
      actorId: 'admin-1',
    })

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'config-audit',
        scope: 'platform-fee',
        key: 'fee-1',
      })
    )
    expect(Object.getOwnPropertyNames(ConfigAuditService.prototype)).toEqual([
      'constructor',
      'append',
      'findByKey',
      'findRecent',
    ])
  })
})
