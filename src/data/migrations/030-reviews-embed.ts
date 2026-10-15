import { ObjectId } from 'mongodb'
import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * Nhúng collection `reviews` vào `apartments.reviews[]` (G-REV, đợt 1/2 của change
 * consolidate-entities-to-40).
 *
 * - Review không có `apartmentId`: căn hộ được suy ra qua `reviews.contractId` ->
 *   `contracts.propertyId` (= `apartments._id`). Review không suy ra được căn hộ là
 *   MỒ CÔI: giữ nguyên trong `reviews`, liệt kê ở `orphans`, KHÔNG làm migration thất bại.
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - Idempotent theo `_id`: review đã có trong mảng căn hộ bị bỏ qua; `_id` cũ được giữ.
 * - Ghi bằng `updateOne` + `$push` có điều kiện (không `save` căn hộ). Căn hộ vượt trần
 *   `APARTMENT_REVIEWS_LIMIT` KHÔNG được cắt: không ghi review nào của căn hộ đó, liệt kê
 *   ở `oversized`, review giữ ở `reviews`.
 * - KHÔNG giả định unique: nhiều review giống nhau (khác `_id`) đều được nhúng.
 * - Đọc nguồn theo lô (sắp `_id`), không nạp cả collection.
 * - Kiểm đếm sau khi ghi từng căn hộ: thiếu `_id` nguồn thì báo lỗi và dừng.
 * - Không xóa `reviews`, không tạo chỉ mục (không có truy vấn nào theo review).
 * - Rollback sao ngược kể cả review đổi sau chuyển code về `reviews` (ghi đè theo `_id`,
 *   chèn nếu chưa có), kiểm đếm theo lô, rồi mới `$unset` mảng của căn hộ đó.
 */
export const REVIEWS_EMBED_MIGRATION_ID = '030-reviews-embed'

/** Trần review mỗi căn hộ (khớp `MAX_APARTMENT_REVIEWS` của schema `Apartment`). */
export const APARTMENT_REVIEWS_LIMIT = 100

/** Trường của review cũ (khớp `Review`); phần tử nhúng giữ đúng các trường này. */
export const REVIEW_FIELDS = [
  '_id',
  'authorId',
  'authorName',
  'targetUserId',
  'contractId',
  'comment',
  'ratings',
  'overall',
  'createdAt',
  'updatedAt',
] as const

const DEFAULT_BATCH_SIZE = 500

type Doc = Record<string, unknown> & { _id: unknown }

export interface ReviewsFindChain {
  sort(spec: Record<string, 1 | -1>): ReviewsFindChain
  limit(count: number): ReviewsFindChain
  toArray(): Promise<Doc[]>
}

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface ReviewsMongoCollection {
  find(filter?: Record<string, unknown>): ReviewsFindChain
  countDocuments(filter?: Record<string, unknown>): Promise<number>
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matchedCount: number }>
  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<unknown>
}

export interface ReviewsMongoDatabase {
  collection(name: string): ReviewsMongoCollection
}

export type ReviewsEmbedOptions = MigrationOptions & { batchSize?: number }

export type ReviewsEmbedMigrationReport = MigrationReport & {
  sourceReviews: number
  /** Số review nguồn đã nằm (hoặc sẽ nằm, khi dry-run) trong mảng căn hộ. */
  embeddedReviews: number
  /** `_id` review không suy ra được căn hộ (giữ ở `reviews`, không lỗi). */
  orphans: string[]
  /** `_id` căn hộ vượt trần: không ghi review nào của căn hộ đó (giữ ở `reviews`). */
  oversized: string[]
  /** Rollback: số review được sao ngược về `reviews` (mới hoặc đã đổi sau chuyển code). */
  restored: number
  /** Rollback: review còn ở `reviews` mà không nằm trong mảng căn hộ nào (không đụng tới). */
  legacyOnly: number
}

function newReport(dryRun: boolean): ReviewsEmbedMigrationReport {
  return {
    migrationId: REVIEWS_EMBED_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    sourceReviews: 0,
    embeddedReviews: 0,
    orphans: [],
    oversized: [],
    restored: 0,
    legacyOnly: 0,
  }
}

/** Đọc `collection` theo lô, sắp `_id` tăng dần; không bao giờ đọc cả collection một lần. */
async function forEachBatch(
  collection: ReviewsMongoCollection,
  filter: Record<string, unknown>,
  batchSize: number,
  handle: (docs: Doc[]) => Promise<void>
): Promise<void> {
  let last: unknown
  for (;;) {
    const scoped =
      last === undefined ? filter : { ...filter, _id: { $gt: last } }
    const docs = await collection
      .find(scoped)
      .sort({ _id: 1 })
      .limit(batchSize)
      .toArray()
    const lastDoc = docs[docs.length - 1]
    if (!lastDoc) return
    await handle(docs)
    last = lastDoc._id
    if (docs.length < batchSize) return
  }
}

function idsOf(entries: unknown): Set<string> {
  const set = new Set<string>()
  if (Array.isArray(entries)) {
    for (const entry of entries as Doc[]) set.add(String(entry._id))
  }
  return set
}

/** Chỉ giữ trường có giá trị (không ghi `undefined` xuống Mongo). */
function pickReviewFields(row: Doc): Record<string, unknown> {
  return Object.fromEntries(
    REVIEW_FIELDS.filter(field => row[field] !== undefined).map(field => [
      field,
      row[field],
    ])
  )
}

/** `_id` hợp lệ (24 hex) của một chuỗi; null nếu không hợp lệ. */
function objectIdOf(value: unknown): ObjectId | null {
  if (typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value)) {
    return new ObjectId(value)
  }
  return null
}

export async function migrateReviewsToEmbedded(
  db: ReviewsMongoDatabase,
  options: ReviewsEmbedOptions = {}
): Promise<ReviewsEmbedMigrationReport> {
  const dryRun = options.dryRun ?? true
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const report = newReport(dryRun)
  const reviews = db.collection('reviews')
  const contracts = db.collection('contracts')
  const apartments = db.collection('apartments')

  let stopped = false
  await forEachBatch(reviews, {}, batchSize, async batch => {
    if (stopped) return
    report.scanned += batch.length
    report.sourceReviews += batch.length

    // Tra căn hộ của cả lô: contractId -> contract.propertyId -> apartment.
    const contractOids = uniqueOids(batch.map(r => r.contractId))
    const contractDocs = contractOids.length
      ? await contracts.find({ _id: { $in: contractOids } }).toArray()
      : []
    const apartmentKeyByContract = new Map<string, string>()
    for (const contract of contractDocs) {
      const oid = objectIdOf(contract.propertyId)
      if (oid)
        apartmentKeyByContract.set(String(contract._id), oid.toHexString())
    }
    const apartmentOids = uniqueOids([...apartmentKeyByContract.values()])
    const apartmentDocs = apartmentOids.length
      ? await apartments.find({ _id: { $in: apartmentOids } }).toArray()
      : []
    const byId = new Map(apartmentDocs.map(a => [String(a._id), a]))

    const groups = new Map<string, Doc[]>()
    for (const review of batch) {
      const contractOid = objectIdOf(review.contractId)
      const key = contractOid
        ? apartmentKeyByContract.get(contractOid.toHexString())
        : undefined
      if (!key || !byId.has(key)) {
        report.orphans.push(String(review._id))
        continue
      }
      const list = groups.get(key) ?? []
      list.push(review)
      groups.set(key, list)
    }

    for (const [key, group] of groups) {
      const apartment = byId.get(key) as Doc
      const existing = idsOf(apartment.reviews)
      const missing = group.filter(r => !existing.has(String(r._id)))
      report.skipped += group.length - missing.length
      if (missing.length === 0) {
        report.embeddedReviews += group.length
        continue
      }
      if (existing.size + missing.length > APARTMENT_REVIEWS_LIMIT) {
        if (!report.oversized.includes(key)) report.oversized.push(key)
        continue
      }
      report.updated += missing.length
      report.embeddedReviews += group.length
      if (dryRun) continue

      await apartments.updateOne(
        {
          _id: apartment._id,
          'reviews._id': { $nin: missing.map(r => r._id) },
        },
        {
          $push: {
            reviews: {
              $each: missing.map(pickReviewFields),
              $sort: { createdAt: 1 },
            },
          },
        }
      )

      // Kiểm đếm: căn hộ phải chứa đủ `_id` nguồn vừa ghi.
      const [after] = await apartments.find({ _id: apartment._id }).toArray()
      const embedded = idsOf(after?.reviews)
      const lacking = missing.filter(r => !embedded.has(String(r._id)))
      if (lacking.length > 0) {
        report.errors.push(
          `apartment ${key}: ${lacking.length}/${missing.length} reviews missing after apply; stopped`
        )
        stopped = true
        return
      }
    }
  })

  return report
}

function uniqueOids(values: unknown[]): ObjectId[] {
  const seen = new Map<string, ObjectId>()
  for (const value of values) {
    const oid = objectIdOf(value)
    if (oid) seen.set(oid.toHexString(), oid)
  }
  return [...seen.values()]
}

/** Dừng rollback khi kiểm đếm sau khi sao ngược lệch; căn hộ đó giữ nguyên mảng. */
class ReviewsRollbackHalted extends Error {}

export async function rollbackReviewsEmbed(
  db: ReviewsMongoDatabase,
  options: ReviewsEmbedOptions = {}
): Promise<ReviewsEmbedMigrationReport> {
  const dryRun = options.dryRun ?? true
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const report = newReport(dryRun)
  const reviews = db.collection('reviews')
  const apartments = db.collection('apartments')
  const embeddedIds = new Set<string>()

  try {
    await forEachBatch(
      apartments,
      { reviews: { $exists: true } },
      batchSize,
      async batch => {
        for (const apartment of batch) {
          report.scanned += 1
          const embedded = (
            Array.isArray(apartment.reviews) ? apartment.reviews : []
          ) as Doc[]
          report.embeddedReviews += embedded.length
          for (const entry of embedded) embeddedIds.add(String(entry._id))
          const ids = embedded.map(e => e._id)
          const legacy = ids.length
            ? await reviews.find({ _id: { $in: ids } }).toArray()
            : []
          const legacyIds = new Set(legacy.map(d => String(d._id)))
          report.restored += embedded.filter(
            e => !legacyIds.has(String(e._id))
          ).length
          report.updated += 1
          if (dryRun) continue

          for (const entry of embedded) {
            const doc = pickReviewFields(entry)
            await reviews.replaceOne({ _id: entry._id }, doc, { upsert: true })
          }
          if (ids.length > 0) {
            const have = await reviews.countDocuments({ _id: { $in: ids } })
            if (have !== ids.length) {
              report.errors.push(
                `apartment ${String(apartment._id)}: ${have}/${ids.length} reviews restored; reviews kept; stopped`
              )
              throw new ReviewsRollbackHalted()
            }
          }
          await apartments.updateOne(
            { _id: apartment._id },
            { $unset: { reviews: '' } }
          )
        }
      }
    )
  } catch (error) {
    if (!(error instanceof ReviewsRollbackHalted)) throw error
  }

  await forEachBatch(reviews, {}, batchSize, batch => {
    for (const row of batch) {
      if (!embeddedIds.has(String(row._id))) report.legacyOnly += 1
    }
    return Promise.resolve()
  })
  return report
}
