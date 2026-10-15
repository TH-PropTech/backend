import { ObjectId } from 'mongodb'
import {
  APARTMENT_ANALYSIS_INDEXES,
  APARTMENT_ANALYSES_MERGE_MIGRATION_ID,
  migrateApartmentAnalyses,
  rollbackApartmentAnalyses,
  type ApartmentAnalysisMongoCollection,
  type ApartmentAnalysisMongoDatabase,
} from './018-apartment-analyses-merge'

type Doc = Record<string, unknown> & { _id: ObjectId }

class FakeCollection implements ApartmentAnalysisMongoCollection {
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
  database: ApartmentAnalysisMongoDatabase
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

describe('018 apartment analyses merge migration', () => {
  function seed(collections: Record<string, FakeCollection>): {
    conditionId: ObjectId
    otherConditionId: ObjectId
    livingWithApartmentId: ObjectId
    livingWithoutApartmentId: ObjectId
  } {
    const ids = {
      conditionId: new ObjectId(),
      otherConditionId: new ObjectId(),
      livingWithApartmentId: new ObjectId(),
      livingWithoutApartmentId: new ObjectId(),
    }
    collections.condition_analyses = new FakeCollection()
    collections.condition_analyses.docs.push(
      {
        _id: ids.conditionId,
        userId: 'user-1',
        apartmentId: 'apt-1',
        imageUrl: `https://app/api/v1/condition-analyses/${ids.conditionId.toString()}/image`,
        imageStorageKey: 'key-1.jpg',
        findings: [],
        overallCondition: 'good',
        checklist: ['wall'],
        model: 'm',
        isPrivate: true,
        createdAt: t(1),
      },
      {
        _id: ids.otherConditionId,
        userId: 'user-2',
        apartmentId: 'apt-2',
        imageUrl: 'https://app/x',
        imageStorageKey: 'key-2.png',
        findings: [],
        overallCondition: 'uncertain',
        checklist: [],
        model: 'm',
        isPrivate: true,
        createdAt: t(2),
      }
    )
    collections.living_cost_profiles = new FakeCollection()
    collections.living_cost_profiles.docs.push(
      {
        _id: ids.livingWithApartmentId,
        userId: 'user-1',
        name: 'Nhà A',
        apartmentId: 'apt-1',
        monthlyRent: 10_000_000,
        serviceFee: 0,
        parkingFee: 0,
        internetFee: 0,
        electricityEstimate: { type: 'estimated', low: 1, mid: 2, high: 3 },
        waterEstimate: { type: 'estimated', low: 1, mid: 2, high: 3 },
        oneTimeCosts: [],
        occupants: 1,
        totalEstimate: { type: 'estimated', low: 1, mid: 2, high: 3 },
        affordabilityStatus: 'unknown',
        confidenceLabel: 'high',
        createdAt: t(3),
        updatedAt: t(3),
      },
      {
        _id: ids.livingWithoutApartmentId,
        userId: 'user-1',
        name: 'Tự do',
        monthlyRent: 5_000_000,
        serviceFee: 0,
        parkingFee: 0,
        internetFee: 0,
        electricityEstimate: { type: 'estimated', low: 1, mid: 2, high: 3 },
        waterEstimate: { type: 'estimated', low: 1, mid: 2, high: 3 },
        oneTimeCosts: [],
        occupants: 1,
        totalEstimate: { type: 'estimated', low: 1, mid: 2, high: 3 },
        affordabilityStatus: 'unknown',
        confidenceLabel: 'medium',
        createdAt: t(4),
        updatedAt: t(4),
      }
    )
    return ids
  }

  it('is a dry run by default: reads and counts but writes nothing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    const report = await migrateApartmentAnalyses(database)

    expect(report).toMatchObject({
      migrationId: APARTMENT_ANALYSES_MERGE_MIGRATION_ID,
      dryRun: true,
      scanned: 4,
      updated: 4,
      skipped: 0,
      errors: [],
    })
    expect(collections.apartment_analyses?.docs ?? []).toHaveLength(0)
    expect(collections.apartment_analyses?.indexes.size ?? 0).toBe(0)
  })

  it('copies by _id with kind, keeps every other field, verifies counts and creates the index', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)

    const report = await migrateApartmentAnalyses(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report).toMatchObject({ scanned: 4, updated: 4, skipped: 0 })
    expect(report.counts).toEqual({
      condition: { source: 2, target: 2 },
      'living-cost': { source: 2, target: 2 },
    })
    const target = collections.apartment_analyses as FakeCollection
    const byId = (id: ObjectId): Doc =>
      target.docs.find(d => d._id.equals(id)) as Doc
    expect(byId(ids.conditionId)).toEqual({
      _id: ids.conditionId,
      kind: 'condition',
      userId: 'user-1',
      apartmentId: 'apt-1',
      imageUrl: `https://app/api/v1/condition-analyses/${ids.conditionId.toString()}/image`,
      imageStorageKey: 'key-1.jpg',
      findings: [],
      overallCondition: 'good',
      checklist: ['wall'],
      model: 'm',
      isPrivate: true,
      createdAt: t(1),
    })
    expect(byId(ids.livingWithApartmentId)).toMatchObject({
      kind: 'living-cost',
      userId: 'user-1',
      name: 'Nhà A',
      apartmentId: 'apt-1',
      monthlyRent: 10_000_000,
      updatedAt: t(3),
    })
    expect(byId(ids.livingWithoutApartmentId)).not.toHaveProperty('apartmentId')
    expect([...target.indexes.keys()]).toEqual(
      APARTMENT_ANALYSIS_INDEXES.map(i => i.name)
    )
    // collection cũ không bị sửa
    expect(collections.condition_analyses?.docs).toHaveLength(2)
    expect(collections.living_cost_profiles?.docs).toHaveLength(2)
  })

  it('is idempotent: running twice copies nothing the second time', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    await migrateApartmentAnalyses(database, { dryRun: false })
    const second = await migrateApartmentAnalyses(database, { dryRun: false })

    expect(second).toMatchObject({ scanned: 4, updated: 0, skipped: 4 })
    expect(collections.apartment_analyses?.docs).toHaveLength(4)
  })

  it('applies and warns when a source row lacks userId or has a wrong type, keeping every row', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    const noOwnerId = new ObjectId()
    const badTypeId = new ObjectId()
    ;(collections.living_cost_profiles as FakeCollection).docs.push({
      _id: noOwnerId,
      name: 'no owner',
    })
    ;(collections.condition_analyses as FakeCollection).docs.push({
      _id: badTypeId,
      userId: 7,
      apartmentId: 'apt-9',
    })

    const dry = await migrateApartmentAnalyses(database)
    expect(dry.errors).toEqual([])
    expect(dry.warnings).toHaveLength(2)
    expect(collections.apartment_analyses?.docs ?? []).toHaveLength(0)

    const report = await migrateApartmentAnalyses(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report.warnings).toHaveLength(2)
    expect(report.warnings.join('\n')).toContain(
      `living_cost_profiles:${noOwnerId.toString()}`
    )
    expect(report.warnings.join('\n')).toContain(
      `condition_analyses:${badTypeId.toString()}`
    )
    expect(report.counts).toEqual({
      condition: { source: 3, target: 3 },
      'living-cost': { source: 3, target: 3 },
    })
    const target = collections.apartment_analyses as FakeCollection
    expect(target.docs).toHaveLength(6)
    const noOwner = target.docs.find(d => d._id.equals(noOwnerId)) as Doc
    expect(noOwner).toEqual({
      _id: noOwnerId,
      kind: 'living-cost',
      name: 'no owner',
    })
    expect(noOwner).not.toHaveProperty('userId')
    const badType = target.docs.find(d => d._id.equals(badTypeId)) as Doc
    expect(badType).toEqual({
      _id: badTypeId,
      kind: 'condition',
      userId: 7,
      apartmentId: 'apt-9',
    })
    expect(target.indexes.size).toBe(APARTMENT_ANALYSIS_INDEXES.length)
  })

  it('refuses to apply (and writes nothing) when the same _id appears in both sources', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    ;(collections.condition_analyses as FakeCollection).docs.push({
      _id: ids.livingWithApartmentId,
      userId: 'user-9',
    })

    const dry = await migrateApartmentAnalyses(database)
    expect(dry.errors).toHaveLength(1)

    await expect(
      migrateApartmentAnalyses(database, { dryRun: false })
    ).rejects.toThrow('refusing to apply')
    expect(collections.apartment_analyses?.docs ?? []).toHaveLength(0)
  })

  it('refuses when an existing target row with the same _id has another kind', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    collections.apartment_analyses = new FakeCollection()
    collections.apartment_analyses.docs.push({
      _id: ids.livingWithApartmentId,
      kind: 'condition',
      userId: 'user-1',
    })

    await expect(
      migrateApartmentAnalyses(database, { dryRun: false })
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
      (update.$setOnInsert as { kind: string }).kind === 'living-cost'
        ? Promise.resolve({ upsertedCount: 0 })
        : realUpdate(filter, update, options)
    collections.apartment_analyses = target

    await expect(
      migrateApartmentAnalyses(database, { dryRun: false })
    ).rejects.toThrow('count mismatch for kind living-cost')
  })

  describe('rollback', () => {
    it('is a dry run by default and changes nothing', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateApartmentAnalyses(database, { dryRun: false })

      const report = await rollbackApartmentAnalyses(database)

      expect(report.dryRun).toBe(true)
      expect(report.updated).toBe(4)
      expect(collections.apartment_analyses?.docs).toHaveLength(4)
      expect(collections.apartment_analyses?.indexes.size).toBe(1)
    })

    it('restores the legacy shape, then drops the new rows and the index', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      const original = JSON.stringify([
        collections.condition_analyses?.docs,
        collections.living_cost_profiles?.docs,
      ])
      await migrateApartmentAnalyses(database, { dryRun: false })

      const report = await rollbackApartmentAnalyses(database, {
        dryRun: false,
      })

      expect(report.errors).toEqual([])
      expect(report.counts).toEqual({
        condition: { source: 2, target: 0 },
        'living-cost': { source: 2, target: 0 },
      })
      expect(collections.apartment_analyses?.docs).toHaveLength(0)
      expect(collections.apartment_analyses?.indexes.size).toBe(0)
      expect(
        JSON.stringify([
          collections.condition_analyses?.docs,
          collections.living_cost_profiles?.docs,
        ])
      ).toBe(original)
    })

    it('copies back changes and rows written after the code switch', async () => {
      const { database, collections } = buildDatabase()
      const ids = seed(collections)
      await migrateApartmentAnalyses(database, { dryRun: false })
      const target = collections.apartment_analyses as FakeCollection

      // sau khi chuyển code: hồ sơ chi phí đổi tên, có phân tích ảnh mới và hồ sơ mới
      const livingRow = target.docs.find(d =>
        d._id.equals(ids.livingWithApartmentId)
      ) as Doc
      livingRow.name = 'Nhà A (đã đổi tên)'
      const newConditionId = new ObjectId()
      const newLivingId = new ObjectId()
      target.docs.push(
        {
          _id: newConditionId,
          kind: 'condition',
          userId: 'user-3',
          apartmentId: 'apt-3',
          imageUrl: 'https://app/y',
          imageStorageKey: 'key-3.webp',
          findings: [],
          overallCondition: 'good',
          checklist: [],
          model: 'm',
          isPrivate: true,
        },
        {
          _id: newLivingId,
          kind: 'living-cost',
          userId: 'user-3',
          name: 'Mới',
          monthlyRent: 1,
        }
      )

      const report = await rollbackApartmentAnalyses(database, {
        dryRun: false,
      })

      expect(report.errors).toEqual([])
      expect(report.restored).toBe(6)
      const conditions = collections.condition_analyses as FakeCollection
      const living = collections.living_cost_profiles as FakeCollection
      expect(
        living.docs.find(d => d._id.equals(ids.livingWithApartmentId))
      ).toMatchObject({ name: 'Nhà A (đã đổi tên)' })
      expect(
        conditions.docs.find(d => d._id.equals(newConditionId))
      ).toMatchObject({ userId: 'user-3', imageStorageKey: 'key-3.webp' })
      expect(living.docs.find(d => d._id.equals(newLivingId))).toMatchObject({
        userId: 'user-3',
        name: 'Mới',
      })
      expect(conditions.docs[0]).not.toHaveProperty('kind')
      expect(target.docs).toHaveLength(0)
    })

    it('keeps the new rows and the index when restoring fails the count check', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateApartmentAnalyses(database, { dryRun: false })
      const living = collections.living_cost_profiles as FakeCollection
      living.replaceOne = (): Promise<{ matchedCount?: number }> =>
        Promise.resolve({ matchedCount: 0 })
      const target = collections.apartment_analyses as FakeCollection
      target.docs.push({
        _id: new ObjectId(),
        kind: 'living-cost',
        userId: 'user-3',
        name: 'new',
      })
      living.updateOne = (): Promise<{ upsertedCount?: number }> =>
        Promise.resolve({ upsertedCount: 0 })

      const report = await rollbackApartmentAnalyses(database, {
        dryRun: false,
      })

      expect(report.errors).toHaveLength(1)
      expect(target.docs.filter(d => d.kind === 'living-cost')).toHaveLength(3)
      expect(target.indexes.size).toBe(1)
    })
  })
})
