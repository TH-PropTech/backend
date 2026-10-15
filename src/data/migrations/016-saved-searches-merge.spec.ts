import { ObjectId } from 'mongodb'
import {
  SAVED_SEARCH_RECORD_INDEXES,
  SAVED_SEARCHES_MERGE_MIGRATION_ID,
  migrateSavedSearches,
  rollbackSavedSearches,
  type SavedSearchesMongoCollection,
  type SavedSearchesMongoDatabase,
} from './016-saved-searches-merge'

type Doc = Record<string, unknown> & { _id: ObjectId }

class FakeCollection implements SavedSearchesMongoCollection {
  docs: Doc[] = []
  indexes = new Map<string, Record<string, 1 | -1>>()

  private matches(doc: Doc, filter: Record<string, unknown> = {}): boolean {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in v) {
        return (v as { $in: ObjectId[] }).$in.some(x =>
          (doc[k] as ObjectId).equals(x)
        )
      }
      return v instanceof ObjectId
        ? (doc[k] as ObjectId).equals(v)
        : doc[k] === v
    })
  }

  find(filter?: Record<string, unknown>): { toArray(): Promise<Doc[]> } {
    return {
      toArray: () =>
        Promise.resolve(this.docs.filter(d => this.matches(d, filter))),
    }
  }

  countDocuments(filter?: Record<string, unknown>): Promise<number> {
    return Promise.resolve(
      this.docs.filter(d => this.matches(d, filter)).length
    )
  }

  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<{ upsertedCount?: number }> {
    if (this.docs.some(d => this.matches(d, filter)))
      return Promise.resolve({ upsertedCount: 0 })
    if (!options?.upsert) return Promise.resolve({ upsertedCount: 0 })
    this.docs.push({
      ...(filter as { _id: ObjectId }),
      ...(update.$setOnInsert as Record<string, unknown>),
    })
    return Promise.resolve({ upsertedCount: 1 })
  }

  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>
  ): Promise<{ matchedCount?: number }> {
    const index = this.docs.findIndex(d => this.matches(d, filter))
    if (index < 0) return Promise.resolve({ matchedCount: 0 })
    const current = this.docs[index] as Doc
    this.docs[index] = { _id: current._id, ...replacement }
    return Promise.resolve({ matchedCount: 1 })
  }

  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount?: number }> {
    const before = this.docs.length
    this.docs = this.docs.filter(d => !this.matches(d, filter))
    return Promise.resolve({ deletedCount: before - this.docs.length })
  }

  createIndex(
    keys: Record<string, 1 | -1>,
    options?: { name?: string }
  ): Promise<string> {
    const name = options?.name ?? JSON.stringify(keys)
    this.indexes.set(name, keys)
    return Promise.resolve(name)
  }

  dropIndex(name: string): Promise<unknown> {
    if (!this.indexes.delete(name)) return Promise.reject(new Error('no index'))
    return Promise.resolve()
  }
}

function buildDatabase(): {
  database: SavedSearchesMongoDatabase
  collections: Record<string, FakeCollection>
} {
  const collections: Record<string, FakeCollection> = {}
  return {
    collections,
    database: {
      collection: (name: string) =>
        (collections[name] ??= new FakeCollection()),
    },
  }
}

const t = (n: number): Date => new Date(Date.UTC(2026, 0, n))

describe('016 saved searches merge migration', () => {
  function seed(collections: Record<string, FakeCollection>): {
    searchId: ObjectId
    searchTwoId: ObjectId
    alertId: ObjectId
  } {
    const ids = {
      searchId: new ObjectId(),
      searchTwoId: new ObjectId(),
      alertId: new ObjectId(),
    }
    collections.saved_searches = new FakeCollection()
    collections.saved_searches.docs.push(
      {
        _id: ids.searchId,
        userId: 'tenant-1',
        name: 'District 1',
        filters: { city: 'Ho Chi Minh', minPrice: 10 },
        alertEnabled: true,
        alertFrequency: 'daily',
        lastAlertSentAt: t(4),
        matchCount: 2,
        createdAt: t(1),
        updatedAt: t(2),
      },
      {
        _id: ids.searchTwoId,
        userId: 'tenant-2',
        name: 'Ha Noi',
        filters: { city: 'Ha Noi' },
        alertEnabled: false,
        alertFrequency: 'weekly',
        matchCount: 0,
        createdAt: t(3),
        updatedAt: t(3),
      }
    )
    collections.search_alerts = new FakeCollection()
    collections.search_alerts.docs.push({
      _id: ids.alertId,
      savedSearchId: ids.searchId.toString(),
      userId: 'tenant-1',
      apartmentId: 'apt-1',
      apartmentTitle: 'Two-bedroom',
      triggerType: 'new_listing',
      matchReason: 'Tin đăng mới',
      isRead: false,
      isDismissed: false,
      deduplicationKey: `${ids.searchId.toString()}:apt-1:new_listing`,
      createdAt: t(5),
    })
    return ids
  }

  it('is a dry run by default: reads and counts but writes nothing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    const report = await migrateSavedSearches(database)

    expect(report).toMatchObject({
      migrationId: SAVED_SEARCHES_MERGE_MIGRATION_ID,
      dryRun: true,
      scanned: 3,
      updated: 3,
      skipped: 0,
      errors: [],
    })
    expect(collections.user_searches?.docs ?? []).toHaveLength(0)
    expect(collections.user_searches?.indexes.size ?? 0).toBe(0)
  })

  it('copies by _id with kind, keeps every other field, verifies counts and creates the indexes', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)

    const report = await migrateSavedSearches(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report).toMatchObject({ scanned: 3, updated: 3, skipped: 0 })
    expect(report.counts).toEqual({
      search: { source: 2, target: 2 },
      alert: { source: 1, target: 1 },
    })
    const target = collections.user_searches as FakeCollection
    const byId = (id: ObjectId): Doc =>
      target.docs.find(d => d._id.equals(id)) as Doc
    expect(byId(ids.searchId)).toEqual({
      _id: ids.searchId,
      kind: 'search',
      userId: 'tenant-1',
      name: 'District 1',
      filters: { city: 'Ho Chi Minh', minPrice: 10 },
      alertEnabled: true,
      alertFrequency: 'daily',
      lastAlertSentAt: t(4),
      matchCount: 2,
      createdAt: t(1),
      updatedAt: t(2),
    })
    expect(byId(ids.alertId)).toEqual({
      _id: ids.alertId,
      kind: 'alert',
      savedSearchId: ids.searchId.toString(),
      userId: 'tenant-1',
      apartmentId: 'apt-1',
      apartmentTitle: 'Two-bedroom',
      triggerType: 'new_listing',
      matchReason: 'Tin đăng mới',
      isRead: false,
      isDismissed: false,
      deduplicationKey: `${ids.searchId.toString()}:apt-1:new_listing`,
      createdAt: t(5),
    })
    expect([...target.indexes.keys()]).toEqual(
      SAVED_SEARCH_RECORD_INDEXES.map(i => i.name)
    )
    expect(SAVED_SEARCH_RECORD_INDEXES.map(i => i.keys)).toEqual([
      { kind: 1, alertEnabled: 1 },
      { kind: 1, userId: 1, createdAt: 1 },
      { kind: 1, deduplicationKey: 1 },
    ])
    // collection cũ không bị sửa
    expect(collections.saved_searches?.docs).toHaveLength(2)
    expect(collections.search_alerts?.docs).toHaveLength(1)
  })

  it('is idempotent: running twice copies nothing the second time', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    await migrateSavedSearches(database, { dryRun: false })
    const second = await migrateSavedSearches(database, { dryRun: false })

    expect(second).toMatchObject({ scanned: 3, updated: 0, skipped: 3 })
    expect(collections.user_searches?.docs).toHaveLength(3)
  })

  it('applies and warns when a source row lacks userId or has a wrong type, keeping every row', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    const noOwnerId = new ObjectId()
    const badTypeId = new ObjectId()
    ;(collections.saved_searches as FakeCollection).docs.push({
      _id: noOwnerId,
      name: 'no owner',
    })
    ;(collections.search_alerts as FakeCollection).docs.push({
      _id: badTypeId,
      userId: 42,
      apartmentId: 'apt-2',
    })

    const dry = await migrateSavedSearches(database)
    expect(dry.errors).toEqual([])
    expect(dry.warnings).toHaveLength(2)
    expect(collections.user_searches?.docs ?? []).toHaveLength(0)

    const report = await migrateSavedSearches(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report.warnings).toHaveLength(2)
    expect(report.warnings.join('\n')).toContain(
      `saved_searches:${noOwnerId.toString()}`
    )
    expect(report.warnings.join('\n')).toContain(
      `search_alerts:${badTypeId.toString()}`
    )
    expect(report.counts).toEqual({
      search: { source: 3, target: 3 },
      alert: { source: 2, target: 2 },
    })
    const target = collections.user_searches as FakeCollection
    expect(target.docs).toHaveLength(5)
    const noOwner = target.docs.find(d => d._id.equals(noOwnerId)) as Doc
    expect(noOwner).toEqual({
      _id: noOwnerId,
      kind: 'search',
      name: 'no owner',
    })
    expect(noOwner).not.toHaveProperty('userId')
    const badType = target.docs.find(d => d._id.equals(badTypeId)) as Doc
    expect(badType).toEqual({
      _id: badTypeId,
      kind: 'alert',
      userId: 42,
      apartmentId: 'apt-2',
    })
    expect(target.indexes.size).toBe(SAVED_SEARCH_RECORD_INDEXES.length)
  })

  it('refuses to apply (and writes nothing) when the same _id appears in both sources', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    ;(collections.search_alerts as FakeCollection).docs.push({
      _id: ids.searchId,
      userId: 'tenant-1',
    })

    const dry = await migrateSavedSearches(database)
    expect(dry.errors).toHaveLength(1)

    await expect(
      migrateSavedSearches(database, { dryRun: false })
    ).rejects.toThrow('refusing to apply')
    expect(collections.user_searches?.docs ?? []).toHaveLength(0)
  })

  it('refuses when an existing target row with the same _id has another kind', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    collections.user_searches = new FakeCollection()
    collections.user_searches.docs.push({
      _id: ids.alertId,
      kind: 'search',
      userId: 'tenant-1',
    })

    await expect(
      migrateSavedSearches(database, { dryRun: false })
    ).rejects.toThrow('refusing to apply')
  })

  it('throws when a source _id is missing from the target after writing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    const target = new FakeCollection()
    const realUpdate = target.updateOne.bind(target)
    target.updateOne = (
      filter,
      update,
      options
    ): Promise<{ upsertedCount?: number }> =>
      (update.$setOnInsert as { kind: string }).kind === 'alert'
        ? Promise.resolve({ upsertedCount: 0 })
        : realUpdate(filter, update, options)
    collections.user_searches = target

    await expect(
      migrateSavedSearches(database, { dryRun: false })
    ).rejects.toThrow('count mismatch for kind alert')
  })

  describe('rollback', () => {
    it('is a dry run by default and changes nothing', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateSavedSearches(database, { dryRun: false })

      const report = await rollbackSavedSearches(database)

      expect(report.dryRun).toBe(true)
      expect(report.updated).toBe(3)
      expect(collections.user_searches?.docs).toHaveLength(3)
      expect(collections.user_searches?.indexes.size).toBe(3)
    })

    it('restores the legacy shape, then drops the new rows and the indexes', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      const original = JSON.stringify([
        collections.saved_searches?.docs,
        collections.search_alerts?.docs,
      ])
      await migrateSavedSearches(database, { dryRun: false })

      const report = await rollbackSavedSearches(database, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(report.counts).toEqual({
        search: { source: 2, target: 0 },
        alert: { source: 1, target: 0 },
      })
      expect(collections.user_searches?.docs).toHaveLength(0)
      expect(collections.user_searches?.indexes.size).toBe(0)
      expect(
        JSON.stringify([
          collections.saved_searches?.docs,
          collections.search_alerts?.docs,
        ])
      ).toBe(original)
    })

    it('copies back changes and rows written after the code switch, per kind', async () => {
      const { database, collections } = buildDatabase()
      const ids = seed(collections)
      await migrateSavedSearches(database, { dryRun: false })
      const target = collections.user_searches as FakeCollection

      // sau khi chuyển code: alert được đánh dấu đã đọc, search mới và alert mới
      const alertRow = target.docs.find(d => d._id.equals(ids.alertId)) as Doc
      alertRow.isRead = true
      const newSearchId = new ObjectId()
      const newAlertId = new ObjectId()
      target.docs.push(
        {
          _id: newSearchId,
          kind: 'search',
          userId: 'tenant-3',
          name: 'New',
          filters: {},
          alertEnabled: true,
          alertFrequency: 'instant',
          matchCount: 0,
        },
        {
          _id: newAlertId,
          kind: 'alert',
          userId: 'tenant-3',
          savedSearchId: newSearchId.toString(),
          apartmentId: 'apt-9',
          isRead: false,
        }
      )

      const report = await rollbackSavedSearches(database, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(report.restored).toBe(5)
      const searches = collections.saved_searches as FakeCollection
      const alerts = collections.search_alerts as FakeCollection
      expect(alerts.docs.find(d => d._id.equals(ids.alertId))).toMatchObject({
        isRead: true,
        userId: 'tenant-1',
      })
      expect(alerts.docs.find(d => d._id.equals(newAlertId))).toMatchObject({
        apartmentId: 'apt-9',
      })
      expect(searches.docs.find(d => d._id.equals(newSearchId))).toMatchObject({
        name: 'New',
        matchCount: 0,
      })
      expect(searches.docs[0]).not.toHaveProperty('kind')
      expect(alerts.docs[0]).not.toHaveProperty('kind')
      expect(target.docs).toHaveLength(0)
    })

    it('keeps the new rows and the indexes when restoring fails the count check', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateSavedSearches(database, { dryRun: false })
      const alerts = collections.search_alerts as FakeCollection
      alerts.replaceOne = (): Promise<{ matchedCount?: number }> =>
        Promise.resolve({ matchedCount: 0 })
      const target = collections.user_searches as FakeCollection
      target.docs.push({
        _id: new ObjectId(),
        kind: 'alert',
        userId: 'tenant-1',
      })
      alerts.updateOne = (): Promise<{ upsertedCount?: number }> =>
        Promise.resolve({ upsertedCount: 0 })

      const report = await rollbackSavedSearches(database, { dryRun: false })

      expect(report.errors).toHaveLength(1)
      expect(target.docs.filter(d => d.kind === 'alert')).toHaveLength(2)
      expect(target.indexes.size).toBe(3)
    })
  })
})
