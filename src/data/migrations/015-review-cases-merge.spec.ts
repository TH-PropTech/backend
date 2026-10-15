import { ObjectId } from 'mongodb'
import {
  REVIEW_CASE_INDEXES,
  REVIEW_CASES_MERGE_MIGRATION_ID,
  migrateReviewCases,
  rollbackReviewCases,
  type ReviewCaseMongoCollection,
  type ReviewCaseMongoDatabase,
} from './015-review-cases-merge'

type Doc = Record<string, unknown> & { _id: ObjectId }

class FakeCollection implements ReviewCaseMongoCollection {
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
  database: ReviewCaseMongoDatabase
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

describe('015 review cases merge migration', () => {
  function seed(collections: Record<string, FakeCollection>): {
    listingPendingId: ObjectId
    listingConfirmedId: ObjectId
    safetyId: ObjectId
  } {
    const ids = {
      listingPendingId: new ObjectId(),
      listingConfirmedId: new ObjectId(),
      safetyId: new ObjectId(),
    }
    collections.listing_review_cases = new FakeCollection()
    collections.listing_review_cases.docs.push(
      {
        _id: ids.listingPendingId,
        apartmentId: 'apt-1',
        relatedApartmentId: 'apt-2',
        type: 'duplicate_photo',
        confidence: 1,
        status: 'pending',
        evidence: 'URL ảnh trùng',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: t(1),
        updatedAt: t(1),
      },
      {
        _id: ids.listingConfirmedId,
        apartmentId: 'apt-1',
        relatedApartmentId: null,
        type: 'stale',
        confidence: 0.5,
        status: 'confirmed',
        evidence: 'Quá hạn',
        reviewedBy: 'staff-1',
        reviewedAt: t(2),
        createdAt: t(2),
        updatedAt: t(2),
      }
    )
    collections.safety_reports = new FakeCollection()
    collections.safety_reports.docs.push({
      _id: ids.safetyId,
      reporterId: 'tenant-1',
      reporterRole: 'tenant',
      targetType: 'listing',
      targetId: 'apt-1',
      category: 'danger',
      description: 'Nguy hiểm',
      evidenceUrls: ['https://cdn.example.com/e.jpg'],
      riskLevel: 'critical',
      status: 'investigating',
      resolutionNote: 'nội bộ',
      assignedTo: 'staff-1',
      assignedAt: t(3),
      isTargetHidden: false,
      createdAt: t(3),
      updatedAt: t(3),
    })
    return ids
  }

  it('is a dry run by default: reads and counts but writes nothing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    const report = await migrateReviewCases(database)

    expect(report).toMatchObject({
      migrationId: REVIEW_CASES_MERGE_MIGRATION_ID,
      dryRun: true,
      scanned: 3,
      updated: 3,
      skipped: 0,
      errors: [],
    })
    expect(collections.review_cases?.docs ?? []).toHaveLength(0)
    expect(collections.review_cases?.indexes.size ?? 0).toBe(0)
  })

  it('copies by _id with kind, keeps every other field, verifies counts and creates the index', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)

    const report = await migrateReviewCases(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report).toMatchObject({ scanned: 3, updated: 3, skipped: 0 })
    expect(report.counts).toEqual({
      listing: { source: 2, target: 2 },
      safety: { source: 1, target: 1 },
    })
    const target = collections.review_cases as FakeCollection
    const byId = (id: ObjectId): Doc =>
      target.docs.find(d => d._id.equals(id)) as Doc
    expect(byId(ids.listingPendingId)).toEqual({
      _id: ids.listingPendingId,
      kind: 'listing',
      apartmentId: 'apt-1',
      relatedApartmentId: 'apt-2',
      type: 'duplicate_photo',
      confidence: 1,
      status: 'pending',
      evidence: 'URL ảnh trùng',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: t(1),
      updatedAt: t(1),
    })
    expect(byId(ids.safetyId)).toEqual({
      _id: ids.safetyId,
      kind: 'safety',
      reporterId: 'tenant-1',
      reporterRole: 'tenant',
      targetType: 'listing',
      targetId: 'apt-1',
      category: 'danger',
      description: 'Nguy hiểm',
      evidenceUrls: ['https://cdn.example.com/e.jpg'],
      riskLevel: 'critical',
      status: 'investigating',
      resolutionNote: 'nội bộ',
      assignedTo: 'staff-1',
      assignedAt: t(3),
      isTargetHidden: false,
      createdAt: t(3),
      updatedAt: t(3),
    })
    expect([...target.indexes.keys()]).toEqual(
      REVIEW_CASE_INDEXES.map(i => i.name)
    )
    expect(target.indexes.get(REVIEW_CASE_INDEXES[0]!.name)).toEqual({
      kind: 1,
      status: 1,
      createdAt: 1,
    })
    // collection cũ không bị sửa
    expect(collections.listing_review_cases?.docs).toHaveLength(2)
    expect(collections.safety_reports?.docs).toHaveLength(1)
    expect(collections.safety_reports?.docs[0]).not.toHaveProperty('kind')
  })

  it('is idempotent: running twice copies nothing the second time', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    await migrateReviewCases(database, { dryRun: false })
    const second = await migrateReviewCases(database, { dryRun: false })

    expect(second).toMatchObject({ scanned: 3, updated: 0, skipped: 3 })
    expect(collections.review_cases?.docs).toHaveLength(3)
  })

  it('reports the duplicate and never writes an _id twice when the same _id appears in both sources', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    ;(collections.safety_reports as FakeCollection).docs.push({
      _id: ids.listingPendingId,
      reporterId: 'dup',
      category: 'spam',
    })

    const dry = await migrateReviewCases(database)
    expect(dry.errors).toHaveLength(1)

    const applied = await migrateReviewCases(database, { dryRun: false })
    expect(applied.errors).toHaveLength(1)
    const written = collections.review_cases?.docs ?? []
    expect(new Set(written.map(d => String(d._id))).size).toBe(written.length)
  })

  it('reports and keeps an existing target row with the same _id and another kind', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    collections.review_cases = new FakeCollection()
    collections.review_cases.docs.push({
      _id: ids.safetyId,
      kind: 'listing',
      status: 'pending',
    })

    const report = await migrateReviewCases(database, { dryRun: false })

    expect(report.errors).toHaveLength(1)
    const kept = collections.review_cases.docs.filter(
      d => String(d._id) === String(ids.safetyId)
    )
    expect(kept).toHaveLength(1)
    expect(kept[0]?.kind).toBe('listing')
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
      (update.$setOnInsert as { kind: string }).kind === 'safety'
        ? Promise.resolve({ upsertedCount: 0 })
        : realUpdate(filter, update, options)
    collections.review_cases = target

    await expect(
      migrateReviewCases(database, { dryRun: false })
    ).rejects.toThrow('count mismatch for kind safety')
  })

  describe('rollback', () => {
    it('is a dry run by default and changes nothing', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateReviewCases(database, { dryRun: false })

      const report = await rollbackReviewCases(database)

      expect(report.dryRun).toBe(true)
      expect(report.updated).toBe(3)
      expect(collections.review_cases?.docs).toHaveLength(3)
      expect(collections.review_cases?.indexes.size).toBe(1)
    })

    it('restores the legacy shape, then drops the new rows and the index', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      const original = JSON.stringify([
        collections.listing_review_cases?.docs,
        collections.safety_reports?.docs,
      ])
      await migrateReviewCases(database, { dryRun: false })

      const report = await rollbackReviewCases(database, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(report.counts).toEqual({
        listing: { source: 2, target: 0 },
        safety: { source: 1, target: 0 },
      })
      expect(collections.review_cases?.docs).toHaveLength(0)
      expect(collections.review_cases?.indexes.size).toBe(0)
      expect(
        JSON.stringify([
          collections.listing_review_cases?.docs,
          collections.safety_reports?.docs,
        ])
      ).toBe(original)
    })

    it('copies back changes and rows written after the code switch', async () => {
      const { database, collections } = buildDatabase()
      const ids = seed(collections)
      await migrateReviewCases(database, { dryRun: false })
      const target = collections.review_cases as FakeCollection

      // sau khi chuyển code: báo cáo safety được xử lý, có listing case mới
      const safetyRow = target.docs.find(d => d._id.equals(ids.safetyId)) as Doc
      safetyRow.status = 'resolved'
      safetyRow.resolvedBy = 'staff-2'
      const newListingId = new ObjectId()
      const newSafetyId = new ObjectId()
      target.docs.push(
        {
          _id: newListingId,
          kind: 'listing',
          apartmentId: 'apt-9',
          type: 'similar_content',
          status: 'pending',
        },
        {
          _id: newSafetyId,
          kind: 'safety',
          reporterId: 'tenant-7',
          category: 'spam',
          status: 'pending',
        }
      )

      const report = await rollbackReviewCases(database, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(report.restored).toBe(5)
      const safety = collections.safety_reports as FakeCollection
      expect(safety.docs.find(d => d._id.equals(ids.safetyId))).toMatchObject({
        status: 'resolved',
        resolvedBy: 'staff-2',
      })
      expect(safety.docs.find(d => d._id.equals(newSafetyId))).toMatchObject({
        reporterId: 'tenant-7',
        category: 'spam',
      })
      expect(
        safety.docs.find(d => d._id.equals(newSafetyId))
      ).not.toHaveProperty('kind')
      const listing = collections.listing_review_cases as FakeCollection
      expect(listing.docs.find(d => d._id.equals(newListingId))).toMatchObject({
        apartmentId: 'apt-9',
        type: 'similar_content',
      })
      expect(listing.docs[0]).not.toHaveProperty('kind')
      expect(target.docs).toHaveLength(0)
    })

    it('keeps the new rows and the index when restoring fails the count check', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateReviewCases(database, { dryRun: false })
      const safety = collections.safety_reports as FakeCollection
      safety.replaceOne = (): Promise<{ matchedCount?: number }> =>
        Promise.resolve({ matchedCount: 0 })
      const target = collections.review_cases as FakeCollection
      target.docs.push({
        _id: new ObjectId(),
        kind: 'safety',
        reporterId: 'new',
        status: 'pending',
      })
      safety.updateOne = (): Promise<{ upsertedCount?: number }> =>
        Promise.resolve({ upsertedCount: 0 })

      const report = await rollbackReviewCases(database, { dryRun: false })

      expect(report.errors).toHaveLength(1)
      expect(target.docs.filter(d => d.kind === 'safety')).toHaveLength(2)
      expect(target.indexes.size).toBe(1)
    })
  })
})
