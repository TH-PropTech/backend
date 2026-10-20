import { NavConfigService, NAV_CONFIG_KEY } from './nav-config.service'

function setup(initial: Record<string, unknown> | null = null): {
  service: NavConfigService
  repo: {
    findOne: ReturnType<typeof jest.fn>
    updateOne: ReturnType<typeof jest.fn>
  }
} {
  let row = initial
  const repo = {
    findOne: jest.fn(() => Promise.resolve(row)),
    updateOne: jest.fn(
      (_filter: unknown, update: { $set: Record<string, unknown> }) => {
        row = { ...(row ?? {}), ...update.$set }
        return Promise.resolve({ matchedCount: 1 })
      }
    ),
  }
  return { service: new NavConfigService(repo as never), repo }
}

describe('NavConfigService', () => {
  it('defaults to showing everything when nothing was saved', async () => {
    const { service } = setup(null)
    await expect(service.get()).resolves.toEqual({
      hiddenForStaff: [],
      updatedAt: null,
      updatedBy: null,
    })
  })

  it('returns the saved hidden tabs with the audit fields', async () => {
    const { service } = setup({
      hiddenTabs: ['community'],
      updatedBy: 'a@x.vn',
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    await expect(service.get()).resolves.toEqual({
      hiddenForStaff: ['community'],
      updatedAt: '2026-01-02T00:00:00.000Z',
      updatedBy: 'a@x.vn',
    })
  })

  it('falls back to the default when the database read fails', async () => {
    const { service, repo } = setup(null)
    repo.findOne.mockRejectedValueOnce(new Error('db down'))
    await expect(service.get()).resolves.toMatchObject({ hiddenForStaff: [] })
  })

  it('upserts atomically on (scope, key), de-duplicating and sorting ids', async () => {
    const { service, repo } = setup(null)
    const out = await service.update(
      ['safety-reports', 'community', 'community'],
      'admin@x.vn'
    )
    expect(repo.updateOne).toHaveBeenCalledTimes(1)
    const [filter, update, opts] = repo.updateOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
      {
        $set: Record<string, unknown>
        $setOnInsert: Record<string, unknown>
      },
      Record<string, unknown>,
    ]
    expect(filter).toEqual({ scope: 'admin-nav', key: NAV_CONFIG_KEY })
    expect(update.$set).toMatchObject({
      hiddenTabs: ['community', 'safety-reports'],
      updatedBy: 'admin@x.vn',
    })
    expect(update.$setOnInsert).toMatchObject({
      scope: 'admin-nav',
      key: NAV_CONFIG_KEY,
    })
    expect(opts).toEqual({ upsert: true })
    expect(out.hiddenForStaff).toEqual(['community', 'safety-reports'])
    expect(out.updatedBy).toBe('admin@x.vn')
  })

  it('can clear every hidden tab', async () => {
    const { service } = setup({ hiddenTabs: ['community'] })
    await expect(service.update([], 'a@x.vn')).resolves.toMatchObject({
      hiddenForStaff: [],
    })
  })
})
