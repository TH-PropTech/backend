/* eslint-disable @typescript-eslint/explicit-function-return-type -- in-memory Mongo fakes */
import { ObjectId } from 'mongodb'
import {
  APARTMENT_REVIEWS_LIMIT,
  migrateReviewsToEmbedded,
  REVIEWS_EMBED_MIGRATION_ID,
  rollbackReviewsEmbed,
  type ReviewsMongoCollection,
  type ReviewsMongoDatabase,
} from './030-reviews-embed'

type Doc = Record<string, unknown> & { _id: unknown }

/** Lấy mọi giá trị tại đường dẫn (mảng được duyệt từng phần tử). */
function get(doc: Doc, path: string): unknown[] {
  let values: unknown[] = [doc]
  for (const part of path.split('.')) {
    values = values.flatMap(v => {
      if (Array.isArray(v)) return v.map(x => (x as Doc)?.[part])
      return [(v as Doc | undefined)?.[part]]
    })
  }
  return values
}

function same(a: unknown, b: unknown): boolean {
  return String(a) === String(b)
}

function matchCond(values: unknown[], cond: unknown): boolean {
  if (
    cond &&
    typeof cond === 'object' &&
    !(cond instanceof ObjectId) &&
    !Array.isArray(cond)
  ) {
    return Object.entries(cond as Doc).every(([op, arg]) => {
      const list = arg as unknown[]
      switch (op) {
        case '$in':
          return values.some(v => list.some(x => same(x, v)))
        case '$nin':
          return !values.some(v => list.some(x => same(x, v)))
        case '$gt':
          return values.some(v => String(v) > String(arg))
        case '$exists':
          return values.some(v => v !== undefined) === arg
        default:
          throw new Error(`unsupported operator ${op}`)
      }
    })
  }
  return values.some(v => same(v, cond))
}

function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) =>
    matchCond(get(doc, key), cond)
  )
}

interface FakeCollection extends ReviewsMongoCollection {
  docs: Doc[]
  writes: number
}

function fakeCollection(
  docs: Doc[],
  opts: { dropPush?: boolean } = {}
): FakeCollection {
  const col: FakeCollection = {
    docs,
    writes: 0,
    find: (filter: Record<string, unknown> = {}) => {
      let rows = docs.filter(d => matches(d, filter))
      let limit: number | undefined
      const chain = {
        sort: () => {
          rows = [...rows].sort((a, b) =>
            same(a._id, b._id) ? 0 : String(a._id) < String(b._id) ? -1 : 1
          )
          return chain
        },
        limit: (n: number) => {
          limit = n
          return chain
        },
        toArray: () =>
          Promise.resolve(limit === undefined ? rows : rows.slice(0, limit)),
      }
      return chain
    },
    countDocuments: (filter: Record<string, unknown> = {}) =>
      Promise.resolve(docs.filter(d => matches(d, filter)).length),
    updateOne: (filter: Doc, update: Doc) => {
      const target = docs.find(d => matches(d, filter))
      if (!target) return Promise.resolve({ matchedCount: 0, modifiedCount: 0 })
      col.writes += 1
      const push = update.$push as
        | Record<string, { $each: Doc[]; $sort?: Record<string, 1 | -1> }>
        | undefined
      if (push && !opts.dropPush) {
        for (const [field, spec] of Object.entries(push)) {
          const list = [
            ...((target[field] as Doc[] | undefined) ?? []),
            ...spec.$each,
          ]
          if (spec.$sort) {
            list.sort(
              (a, b) =>
                new Date(String(a.createdAt)).getTime() -
                new Date(String(b.createdAt)).getTime()
            )
          }
          target[field] = list
        }
      }
      if (update.$set) Object.assign(target, update.$set)
      if (update.$unset) {
        for (const k of Object.keys(update.$unset)) delete target[k]
      }
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
    },
    replaceOne: (filter: Doc, doc: Doc, options?: { upsert?: boolean }) => {
      const target = docs.find(d => matches(d, filter))
      if (target) {
        col.writes += 1
        for (const k of Object.keys(target)) delete target[k]
        Object.assign(target, doc)
        return Promise.resolve({ matchedCount: 1 })
      }
      if (options?.upsert) {
        col.writes += 1
        docs.push({ ...doc })
        return Promise.resolve({ matchedCount: 0 })
      }
      return Promise.resolve({ matchedCount: 0 })
    },
  }
  return col
}

function setup(
  data: {
    apartments?: Doc[]
    reviews?: Doc[]
    contracts?: Doc[]
  },
  opts: { dropPush?: boolean } = {}
) {
  const apartments = fakeCollection(data.apartments ?? [], opts)
  const reviews = fakeCollection(data.reviews ?? [])
  const contracts = fakeCollection(data.contracts ?? [])
  const cols: Record<string, FakeCollection> = {
    apartments,
    reviews,
    contracts,
  }
  const db: ReviewsMongoDatabase = {
    collection: name => {
      const col = cols[name]
      if (!col) throw new Error(`unexpected collection ${name}`)
      return col
    },
  }
  return { db, apartments, reviews, contracts }
}

const aptId = new ObjectId()
const otherAptId = new ObjectId()
const contractA = new ObjectId()
const contractB = new ObjectId()

function review(
  contractId: unknown,
  minute: number,
  extra: Partial<Doc> = {}
): Doc {
  return {
    _id: new ObjectId(),
    authorId: 'tenant-1',
    authorName: 'Tenant',
    targetUserId: 'landlord-1',
    contractId,
    comment: `c${minute}`,
    ratings: {
      responsiveness: 5,
      quality: 4,
      maintenance: 4,
      commitment: 5,
    },
    overall: 4,
    createdAt: new Date(2026, 0, 1, 0, minute),
    updatedAt: new Date(2026, 0, 1, 0, minute),
    ...extra,
  }
}

function contract(id: ObjectId, propertyId: string): Doc {
  return { _id: id, propertyId }
}

function embeddedEntries(count: number, startMinute = 0): Doc[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: new ObjectId(),
    authorId: 'tenant-old',
    authorName: 'Old',
    targetUserId: 'landlord-1',
    contractId: String(contractA),
    comment: `e${startMinute + i}`,
    ratings: { responsiveness: 1, quality: 1, maintenance: 1, commitment: 1 },
    overall: 1,
    createdAt: new Date(2025, 0, 1, 0, startMinute + i),
    updatedAt: new Date(2025, 0, 1, 0, startMinute + i),
  }))
}

describe('030-reviews-embed', () => {
  it('dry-run reports but writes nothing', async () => {
    const r1 = review(String(contractA), 1)
    const { db, apartments } = setup({
      apartments: [{ _id: aptId }],
      contracts: [contract(contractA, String(aptId))],
      reviews: [r1],
    })

    const report = await migrateReviewsToEmbedded(db)

    expect(report).toMatchObject({
      migrationId: REVIEWS_EMBED_MIGRATION_ID,
      dryRun: true,
      sourceReviews: 1,
      embeddedReviews: 1,
      updated: 1,
      errors: [],
      orphans: [],
      oversized: [],
    })
    expect(apartments.writes).toBe(0)
    expect(apartments.docs[0]?.reviews).toBeUndefined()
  })

  it('embeds reviews by $push via contract.propertyId, keeps _id and fields, keeps the source', async () => {
    const r1 = review(String(contractA), 2)
    const r2 = review(String(contractB), 1)
    const { db, apartments, reviews } = setup({
      apartments: [{ _id: aptId }, { _id: otherAptId }],
      contracts: [
        contract(contractA, String(aptId)),
        contract(contractB, String(otherAptId)),
      ],
      reviews: [r1, r2],
    })

    const report = await migrateReviewsToEmbedded(db, { dryRun: false })

    expect(report).toMatchObject({
      dryRun: false,
      sourceReviews: 2,
      embeddedReviews: 2,
      updated: 2,
      errors: [],
      orphans: [],
    })
    const [apt, other] = apartments.docs
    const embedded = apt?.reviews as Doc[]
    expect(embedded).toHaveLength(1)
    expect(embedded[0]).toEqual({
      _id: r1._id,
      authorId: 'tenant-1',
      authorName: 'Tenant',
      targetUserId: 'landlord-1',
      contractId: String(contractA),
      comment: 'c2',
      ratings: r1.ratings,
      overall: 4,
      createdAt: r1.createdAt,
      updatedAt: r1.updatedAt,
    })
    expect((other?.reviews as Doc[])[0]?._id).toEqual(r2._id)
    // Collection cũ không bị xóa hay sửa.
    expect(reviews.docs).toHaveLength(2)
  })

  it('is idempotent by _id: a second apply writes nothing and does not duplicate', async () => {
    const r1 = review(String(contractA), 1)
    const { db, apartments } = setup({
      apartments: [{ _id: aptId }],
      contracts: [contract(contractA, String(aptId))],
      reviews: [r1],
    })
    await migrateReviewsToEmbedded(db, { dryRun: false })
    const writesAfterFirst = apartments.writes

    const second = await migrateReviewsToEmbedded(db, { dryRun: false })

    expect(second).toMatchObject({ updated: 0, skipped: 1, embeddedReviews: 1 })
    expect(apartments.writes).toBe(writesAfterFirst)
    expect(apartments.docs[0]?.reviews as Doc[]).toHaveLength(1)
  })

  it('keeps orphan reviews in the source and reports them without failing', async () => {
    const good = review(String(contractA), 1)
    const badContractId = review('not-an-object-id', 2)
    const missingContract = review(String(new ObjectId()), 3)
    const contractToGone = review(String(contractB), 4)
    const { db, apartments, reviews } = setup({
      apartments: [{ _id: aptId }],
      contracts: [
        contract(contractA, String(aptId)),
        contract(contractB, String(new ObjectId())),
      ],
      reviews: [good, badContractId, missingContract, contractToGone],
    })

    const report = await migrateReviewsToEmbedded(db, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(new Set(report.orphans)).toEqual(
      new Set([
        String(badContractId._id),
        String(missingContract._id),
        String(contractToGone._id),
      ])
    )
    expect(apartments.docs[0]?.reviews as Doc[]).toHaveLength(1)
    expect(reviews.docs).toHaveLength(4)
  })

  it('does not embed an apartment over the cap; reports it as oversized and keeps the source', async () => {
    const existing = embeddedEntries(APARTMENT_REVIEWS_LIMIT - 3)
    const newcomers = [
      review(String(contractA), 1),
      review(String(contractA), 2),
      review(String(contractA), 3),
      review(String(contractA), 4),
    ]
    const { db, apartments, reviews } = setup({
      apartments: [{ _id: aptId, reviews: existing }],
      contracts: [contract(contractA, String(aptId))],
      reviews: newcomers,
    })

    const report = await migrateReviewsToEmbedded(db, { dryRun: false })

    expect(report.oversized).toEqual([String(aptId)])
    expect(apartments.docs[0]?.reviews as Doc[]).toHaveLength(
      APARTMENT_REVIEWS_LIMIT - 3
    )
    expect(reviews.docs).toHaveLength(4)
    expect(report.embeddedReviews).toBe(0)
    expect(report.errors).toEqual([])
  })

  it('accepts exactly the cap', async () => {
    const existing = embeddedEntries(APARTMENT_REVIEWS_LIMIT - 2)
    const newcomers = [
      review(String(contractA), 1),
      review(String(contractA), 2),
    ]
    const { db, apartments } = setup({
      apartments: [{ _id: aptId, reviews: existing }],
      contracts: [contract(contractA, String(aptId))],
      reviews: newcomers,
    })

    const report = await migrateReviewsToEmbedded(db, { dryRun: false })

    expect(report.oversized).toEqual([])
    expect(apartments.docs[0]?.reviews as Doc[]).toHaveLength(
      APARTMENT_REVIEWS_LIMIT
    )
  })

  it('does not deduplicate: identical-looking reviews with different _id are both embedded', async () => {
    const a = review(String(contractA), 1)
    const b = review(String(contractA), 1)
    const { db, apartments } = setup({
      apartments: [{ _id: aptId }],
      contracts: [contract(contractA, String(aptId))],
      reviews: [a, b],
    })

    const report = await migrateReviewsToEmbedded(db, { dryRun: false })

    expect(report.embeddedReviews).toBe(2)
    expect(apartments.docs[0]?.reviews as Doc[]).toHaveLength(2)
  })

  it('reads the source in batches and embeds every batch', async () => {
    const rows = [1, 2, 3, 4, 5].map(m => review(String(contractA), m))
    const { db, apartments } = setup({
      apartments: [{ _id: aptId }],
      contracts: [contract(contractA, String(aptId))],
      reviews: rows,
    })

    const report = await migrateReviewsToEmbedded(db, {
      dryRun: false,
      batchSize: 2,
    })

    expect(report.scanned).toBe(5)
    expect(report.errors).toEqual([])
    expect(apartments.docs[0]?.reviews as Doc[]).toHaveLength(5)
  })

  it('stops with an error when the embedded array does not contain the source _id after apply', async () => {
    const r1 = review(String(contractA), 1)
    const { db } = setup(
      {
        apartments: [{ _id: aptId }],
        contracts: [contract(contractA, String(aptId))],
        reviews: [r1],
      },
      { dropPush: true }
    )

    const report = await migrateReviewsToEmbedded(db, { dryRun: false })

    expect(report.errors).toEqual([
      expect.stringContaining('1/1 reviews missing after apply'),
    ])
  })

  describe('rollback', () => {
    it('dry-run writes nothing', async () => {
      const r1 = review(String(contractA), 1)
      const { db, apartments, reviews } = setup({
        apartments: [{ _id: aptId, reviews: [{ ...r1 }] }],
        contracts: [contract(contractA, String(aptId))],
        reviews: [],
      })

      const report = await rollbackReviewsEmbed(db)

      expect(report.dryRun).toBe(true)
      expect(apartments.writes).toBe(0)
      expect(reviews.writes).toBe(0)
      expect(apartments.docs[0]?.reviews).toBeDefined()
    })

    it('restores embedded reviews (including changes made after the switch), removes the array, keeps orphans', async () => {
      const legacyOld = review(String(contractA), 1, { comment: 'old' })
      const embeddedLatest = { ...legacyOld, comment: 'new' }
      const fresh = review(String(contractA), 2, {
        comment: 'created-after-switch',
      })
      const orphan = review('not-an-object-id', 3)
      const { db, apartments, reviews } = setup({
        apartments: [{ _id: aptId, reviews: [embeddedLatest, fresh] }],
        contracts: [contract(contractA, String(aptId))],
        reviews: [legacyOld, orphan],
      })

      const report = await rollbackReviewsEmbed(db, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(report.restored).toBe(1)
      expect(apartments.docs[0]?.reviews).toBeUndefined()
      const byId = new Map(reviews.docs.map(d => [String(d._id), d]))
      expect(byId.get(String(legacyOld._id))?.comment).toBe('new')
      expect(byId.get(String(fresh._id))?.comment).toBe('created-after-switch')
      expect(byId.get(String(orphan._id))).toBeDefined()
      expect(report.legacyOnly).toBe(1)
    })

    it('apply then rollback then apply round-trips without loss', async () => {
      const r1 = review(String(contractA), 1)
      const r2 = review(String(contractA), 2)
      const { db, apartments, reviews } = setup({
        apartments: [{ _id: aptId }],
        contracts: [contract(contractA, String(aptId))],
        reviews: [r1, r2],
      })

      await migrateReviewsToEmbedded(db, { dryRun: false })
      await rollbackReviewsEmbed(db, { dryRun: false })
      expect(apartments.docs[0]?.reviews).toBeUndefined()
      expect(reviews.docs).toHaveLength(2)

      const again = await migrateReviewsToEmbedded(db, { dryRun: false })
      expect(again.embeddedReviews).toBe(2)
      expect(apartments.docs[0]?.reviews as Doc[]).toHaveLength(2)
    })
  })
})
