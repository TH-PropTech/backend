import { ObjectId } from 'mongodb'
import {
  DISTRICT_DATA_INDEXES,
  DISTRICT_DATA_MERGE_MIGRATION_ID,
  migrateDistrictData,
  rollbackDistrictData,
  type DistrictDataMongoCollection,
  type DistrictDataMongoDatabase,
} from './017-district-data-merge'

type Doc = Record<string, unknown> & { _id: ObjectId }

class FakeCollection implements DistrictDataMongoCollection {
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
  database: DistrictDataMongoDatabase
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

describe('017 district data merge migration', () => {
  function seed(collections: Record<string, FakeCollection>): {
    areaWithWardId: ObjectId
    areaNoWardId: ObjectId
    riskId: ObjectId
  } {
    const ids = {
      areaWithWardId: new ObjectId(),
      areaNoWardId: new ObjectId(),
      riskId: new ObjectId(),
    }
    collections.area_profiles = new FakeCollection()
    collections.area_profiles.docs.push(
      {
        _id: ids.areaWithWardId,
        district: 'Quận 7',
        city: 'Hồ Chí Minh',
        ward: 'Phường Tân Phú',
        overview: 'Tổng quan',
        facilities: [{ type: 'school', name: 'Trường A', distanceMeters: 300 }],
        source: 'Khảo sát',
        disclaimer: 'tham khảo',
        lastSurveyedAt: t(1),
        createdAt: t(1),
        updatedAt: t(1),
      },
      {
        _id: ids.areaNoWardId,
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
        overview: 'Tổng quan 2',
        facilities: [],
        source: 'Khảo sát 2',
        disclaimer: 'tham khảo',
        lastSurveyedAt: t(2),
        createdAt: t(2),
        updatedAt: t(2),
      }
    )
    collections.risk_layer_data = new FakeCollection()
    collections.risk_layer_data.docs.push({
      _id: ids.riskId,
      district: 'Quận 7',
      layerType: 'flood',
      severity: 80,
      source: 'Nguồn',
      timestamp: t(3),
      confidence: 0.9,
      geoJson: null,
      createdAt: t(3),
      updatedAt: t(3),
    })
    return ids
  }

  it('is a dry run by default: reads and counts but writes nothing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    const report = await migrateDistrictData(database)

    expect(report).toMatchObject({
      migrationId: DISTRICT_DATA_MERGE_MIGRATION_ID,
      dryRun: true,
      scanned: 3,
      updated: 3,
      skipped: 0,
      errors: [],
    })
    expect(collections.district_data?.docs ?? []).toHaveLength(0)
    expect(collections.district_data?.indexes.size ?? 0).toBe(0)
  })

  it('copies by _id with kind, keeps every other field, verifies counts and creates the indexes', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)

    const report = await migrateDistrictData(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report).toMatchObject({ scanned: 3, updated: 3, skipped: 0 })
    expect(report.counts).toEqual({
      'area-profile': { source: 2, target: 2 },
      'risk-layer': { source: 1, target: 1 },
    })
    const target = collections.district_data as FakeCollection
    const byId = (id: ObjectId): Doc =>
      target.docs.find(d => d._id.equals(id)) as Doc
    expect(byId(ids.areaWithWardId)).toEqual({
      _id: ids.areaWithWardId,
      kind: 'area-profile',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
      ward: 'Phường Tân Phú',
      overview: 'Tổng quan',
      facilities: [{ type: 'school', name: 'Trường A', distanceMeters: 300 }],
      source: 'Khảo sát',
      disclaimer: 'tham khảo',
      lastSurveyedAt: t(1),
      createdAt: t(1),
      updatedAt: t(1),
    })
    expect(byId(ids.areaNoWardId)).not.toHaveProperty('ward')
    expect(byId(ids.riskId)).toEqual({
      _id: ids.riskId,
      kind: 'risk-layer',
      district: 'Quận 7',
      layerType: 'flood',
      severity: 80,
      source: 'Nguồn',
      timestamp: t(3),
      confidence: 0.9,
      geoJson: null,
      createdAt: t(3),
      updatedAt: t(3),
    })
    expect([...target.indexes.keys()]).toEqual(
      DISTRICT_DATA_INDEXES.map(i => i.name)
    )
    // collection cũ không bị sửa
    expect(collections.area_profiles?.docs).toHaveLength(2)
    expect(collections.risk_layer_data?.docs).toHaveLength(1)
  })

  it('is idempotent: running twice copies nothing the second time', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    await migrateDistrictData(database, { dryRun: false })
    const second = await migrateDistrictData(database, { dryRun: false })

    expect(second).toMatchObject({ scanned: 3, updated: 0, skipped: 3 })
    expect(collections.district_data?.docs).toHaveLength(3)
  })

  it('applies and warns when a source row lacks district or has a wrong type, keeping every row', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    const noDistrictId = new ObjectId()
    const badTypeId = new ObjectId()
    ;(collections.area_profiles as FakeCollection).docs.push({
      _id: noDistrictId,
      city: 'no district',
    })
    ;(collections.risk_layer_data as FakeCollection).docs.push({
      _id: badTypeId,
      district: 1234,
      layerType: 'flood',
    })

    const dry = await migrateDistrictData(database)
    expect(dry.errors).toEqual([])
    expect(dry.warnings).toHaveLength(2)
    expect(collections.district_data?.docs ?? []).toHaveLength(0)

    const report = await migrateDistrictData(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report.warnings).toHaveLength(2)
    expect(report.warnings.join('\n')).toContain(
      `area_profiles:${noDistrictId.toString()}`
    )
    expect(report.warnings.join('\n')).toContain(
      `risk_layer_data:${badTypeId.toString()}`
    )
    expect(report.counts).toEqual({
      'area-profile': { source: 3, target: 3 },
      'risk-layer': { source: 2, target: 2 },
    })
    const target = collections.district_data as FakeCollection
    expect(target.docs).toHaveLength(5)
    const noDistrict = target.docs.find(d => d._id.equals(noDistrictId)) as Doc
    expect(noDistrict).toEqual({
      _id: noDistrictId,
      kind: 'area-profile',
      city: 'no district',
    })
    expect(noDistrict).not.toHaveProperty('district')
    const badType = target.docs.find(d => d._id.equals(badTypeId)) as Doc
    expect(badType).toEqual({
      _id: badTypeId,
      kind: 'risk-layer',
      district: 1234,
      layerType: 'flood',
    })
    expect(target.indexes.size).toBe(DISTRICT_DATA_INDEXES.length)
  })

  it('refuses to apply (and writes nothing) when the same _id appears in both sources', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    ;(collections.risk_layer_data as FakeCollection).docs.push({
      _id: ids.areaWithWardId,
      district: 'dup',
    })

    const dry = await migrateDistrictData(database)
    expect(dry.errors).toHaveLength(1)

    await expect(
      migrateDistrictData(database, { dryRun: false })
    ).rejects.toThrow('refusing to apply')
    expect(collections.district_data?.docs ?? []).toHaveLength(0)
  })

  it('refuses when an existing target row with the same _id has another kind', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    collections.district_data = new FakeCollection()
    collections.district_data.docs.push({
      _id: ids.riskId,
      kind: 'area-profile',
      district: 'x',
    })

    await expect(
      migrateDistrictData(database, { dryRun: false })
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
      (update.$setOnInsert as { kind: string }).kind === 'risk-layer'
        ? Promise.resolve({ upsertedCount: 0 })
        : realUpdate(filter, update, options)
    collections.district_data = target

    await expect(
      migrateDistrictData(database, { dryRun: false })
    ).rejects.toThrow('count mismatch for kind risk-layer')
  })

  describe('rollback', () => {
    it('is a dry run by default and changes nothing', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateDistrictData(database, { dryRun: false })

      const report = await rollbackDistrictData(database)

      expect(report.dryRun).toBe(true)
      expect(report.updated).toBe(3)
      expect(collections.district_data?.docs).toHaveLength(3)
      expect(collections.district_data?.indexes.size).toBe(
        DISTRICT_DATA_INDEXES.length
      )
    })

    it('restores the legacy shape, then drops the new rows and the indexes', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      const original = JSON.stringify([
        collections.area_profiles?.docs,
        collections.risk_layer_data?.docs,
      ])
      await migrateDistrictData(database, { dryRun: false })

      const report = await rollbackDistrictData(database, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(report.counts).toEqual({
        'area-profile': { source: 2, target: 0 },
        'risk-layer': { source: 1, target: 0 },
      })
      expect(collections.district_data?.docs).toHaveLength(0)
      expect(collections.district_data?.indexes.size).toBe(0)
      expect(
        JSON.stringify([
          collections.area_profiles?.docs,
          collections.risk_layer_data?.docs,
        ])
      ).toBe(original)
    })

    it('copies back changes and rows written after the code switch', async () => {
      const { database, collections } = buildDatabase()
      const ids = seed(collections)
      await migrateDistrictData(database, { dryRun: false })
      const target = collections.district_data as FakeCollection

      // sau khi chuyển code: hồ sơ khu vực được sửa, có thêm một lớp rủi ro mới
      const areaRow = target.docs.find(d =>
        d._id.equals(ids.areaWithWardId)
      ) as Doc
      areaRow.overview = 'Tổng quan mới'
      areaRow.updatedAt = t(9)
      const newRiskId = new ObjectId()
      target.docs.push({
        _id: newRiskId,
        kind: 'risk-layer',
        district: 'Quận 1',
        layerType: 'noise',
        severity: 10,
      })

      const report = await rollbackDistrictData(database, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(report.restored).toBe(4)
      const areas = collections.area_profiles as FakeCollection
      const risks = collections.risk_layer_data as FakeCollection
      expect(
        areas.docs.find(d => d._id.equals(ids.areaWithWardId))
      ).toMatchObject({
        district: 'Quận 7',
        overview: 'Tổng quan mới',
        updatedAt: t(9),
      })
      expect(risks.docs.find(d => d._id.equals(newRiskId))).toMatchObject({
        district: 'Quận 1',
        layerType: 'noise',
        severity: 10,
      })
      expect(risks.docs.find(d => d._id.equals(newRiskId))).not.toHaveProperty(
        'kind'
      )
      expect(areas.docs[0]).not.toHaveProperty('kind')
      expect(target.docs).toHaveLength(0)
    })

    it('keeps the new rows and the indexes when restoring fails the count check', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateDistrictData(database, { dryRun: false })
      const risks = collections.risk_layer_data as FakeCollection
      risks.replaceOne = (): Promise<{ matchedCount?: number }> =>
        Promise.resolve({ matchedCount: 0 })
      const target = collections.district_data as FakeCollection
      target.docs.push({
        _id: new ObjectId(),
        kind: 'risk-layer',
        district: 'new',
      })
      risks.updateOne = (): Promise<{ upsertedCount?: number }> =>
        Promise.resolve({ upsertedCount: 0 })

      const report = await rollbackDistrictData(database, { dryRun: false })

      expect(report.errors).toHaveLength(1)
      expect(target.docs.filter(d => d.kind === 'risk-layer')).toHaveLength(2)
      expect(target.indexes.size).toBe(DISTRICT_DATA_INDEXES.length)
    })
  })
})
