/* eslint-disable @typescript-eslint/explicit-function-return-type -- in-memory fakes */
import { RecommendationConfigService } from './recommendation-config.service'

type Row = Record<string, unknown>

/** Kho giả theo `where`: khớp mọi trường được lọc, không phụ thuộc tên collection. */
function makeRepo(seed: Row[] = []): {
  rows: Row[]
  wheres: Array<Record<string, unknown>>
  repo: Record<'findOne' | 'create' | 'save' | 'merge', jest.Mock>
} {
  const rows = [...seed]
  const wheres: Array<Record<string, unknown>> = []
  const repo = {
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      wheres.push(where)
      return Promise.resolve(
        rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) ??
          null
      )
    }),
    create: jest.fn((v: Row) => ({ ...v })),
    merge: jest.fn((target: Row, patch: Row) => Object.assign(target, patch)),
    save: jest.fn((v: Row) => {
      v._id ??= `id-${rows.length + 1}`
      v.updatedAt = new Date('2026-01-01T00:00:00Z')
      if (!rows.includes(v)) rows.push(v)
      return Promise.resolve(v)
    }),
  }
  return { rows, wheres, repo }
}

/** Dòng cấu hình đã lưu (SystemConfig{scope:recommendation}). */
const storedRow = (extra: Row): Row => ({
  _id: 'seed-1',
  scope: 'recommendation',
  key: 'global',
  strategy: 'map',
  alpha: 2,
  nbWeight: 0.7,
  ruleWeight: 0.3,
  updatedAt: new Date('2025-05-05T00:00:00Z'),
  ...extra,
})

const API_KEYS = [
  '_id',
  'alpha',
  'configId',
  'nbWeight',
  'ruleWeight',
  'strategy',
  'updatedAt',
]

describe('RecommendationConfigService', () => {
  const build = (seed: Row[] = []) => {
    const made = makeRepo(seed)
    return {
      ...made,
      service: new RecommendationConfigService(made.repo as never),
    }
  }

  it('initialises and persists the default hybrid config when none exists', async () => {
    const { service, repo } = build()

    const config = await service.getConfig()

    expect(config).toMatchObject({
      configId: 'global',
      strategy: 'hybrid',
      alpha: 1,
      nbWeight: 0.5,
      ruleWeight: 0.5,
    })
    expect(repo.save).toHaveBeenCalledTimes(1)
  })

  it('returns the stored config without saving again', async () => {
    const { service, repo } = build([storedRow({ updatedBy: 'a@b.vn' })])

    const config = await service.getConfig()

    expect(config).toMatchObject({
      configId: 'global',
      strategy: 'map',
      alpha: 2,
      nbWeight: 0.7,
      ruleWeight: 0.3,
      updatedBy: 'a@b.vn',
    })
    expect(repo.save).not.toHaveBeenCalled()
  })

  it('falls back to an in-memory default (null _id) when the read fails', async () => {
    const { service, repo } = build()
    repo.findOne.mockRejectedValue(new Error('db down'))

    const config = await service.getConfig()

    expect(config).toMatchObject({
      _id: null,
      configId: 'global',
      strategy: 'hybrid',
      alpha: 1,
      nbWeight: 0.5,
      ruleWeight: 0.5,
    })
    expect(config.updatedAt).toBeInstanceOf(Date)
  })

  it('updates the stored config, records the admin and persists it', async () => {
    const { service, rows } = build([storedRow({})])

    const saved = await service.updateConfig(
      { strategy: 'weighted', alpha: 3, nbWeight: 0.6, ruleWeight: 0.4 },
      'admin@th-proptech.vn'
    )

    expect(saved).toMatchObject({
      configId: 'global',
      strategy: 'weighted',
      alpha: 3,
      nbWeight: 0.6,
      ruleWeight: 0.4,
      updatedBy: 'admin@th-proptech.vn',
    })
    expect(rows).toHaveLength(1)
    await expect(service.getConfig()).resolves.toMatchObject({
      strategy: 'weighted',
      updatedBy: 'admin@th-proptech.vn',
    })
  })

  it('creates the default first when updating with no stored config', async () => {
    const { service, rows } = build()

    const saved = await service.updateConfig(
      { strategy: 'map', alpha: 1.5, nbWeight: 0.5, ruleWeight: 0.5 },
      'admin@th-proptech.vn'
    )

    expect(saved.strategy).toBe('map')
    expect(saved.updatedBy).toBe('admin@th-proptech.vn')
    expect(rows).toHaveLength(1)
  })

  it('exposes exactly the API shape (no scope/key leak)', async () => {
    const { service } = build([storedRow({})])
    const read = JSON.parse(JSON.stringify(await service.getConfig())) as Row
    expect(Object.keys(read).sort()).toEqual(API_KEYS)

    const updated = JSON.parse(
      JSON.stringify(
        await service.updateConfig(
          { strategy: 'map', alpha: 1, nbWeight: 0.5, ruleWeight: 0.5 },
          'admin@th-proptech.vn'
        )
      )
    ) as Row
    expect(Object.keys(updated).sort()).toEqual([...API_KEYS, 'updatedBy'])
  })

  it('always filters reads by the config key', async () => {
    const { service, wheres } = build([storedRow({})])
    await service.getConfig()
    await service.updateConfig(
      { strategy: 'map', alpha: 1, nbWeight: 0.5, ruleWeight: 0.5 },
      'x'
    )
    expect(wheres.length).toBeGreaterThan(0)
    for (const where of wheres) {
      expect(JSON.stringify(where)).toContain('global')
    }
  })
})
