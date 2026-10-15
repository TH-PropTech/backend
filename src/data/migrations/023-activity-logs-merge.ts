import type { ActivityLogKind } from '../../modules/activity-log/schemas/activity-log.schema'
import {
  LEGACY_LOG_FIELDS,
  pickLegacyFields,
} from '../../modules/activity-log/utils/legacy-log.mapper'
import type { MigrationOptions, MigrationReport } from './migration.types'

export const ACTIVITY_LOGS_MERGE_MIGRATION_ID = '023-activity-logs-merge'

export const ACTIVITY_LOGS_COLLECTION = 'activity_logs'

/** Số bản ghi đọc/ghi mỗi lô; không bao giờ nạp cả collection vào bộ nhớ. */
const DEFAULT_BATCH_SIZE = 500

type Doc = Record<string, unknown> & { _id: unknown }

/** Tập con của `FindCursor` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface ActivityLogFindChain {
  sort(spec: Record<string, 1 | -1>): ActivityLogFindChain
  limit(count: number): ActivityLogFindChain
  toArray(): Promise<Doc[]>
}

/** Tập con của `Collection` trong mongodb driver mà migration cần. */
export interface ActivityLogMongoCollection {
  find(filter?: Record<string, unknown>): ActivityLogFindChain
  countDocuments(filter?: Record<string, unknown>): Promise<number>
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<unknown>
  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>
  ): Promise<unknown>
  deleteMany(filter: Record<string, unknown>): Promise<unknown>
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: { name?: string }
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export interface ActivityLogMongoDatabase {
  collection(name: string): ActivityLogMongoCollection
}

export type ActivityLogMigrationOptions = MigrationOptions & {
  batchSize?: number
}

export type ActivityLogCount = { source: number; target: number }

export type ActivityLogMigrationReport = MigrationReport & {
  counts: Record<ActivityLogKind, ActivityLogCount>
  /** Rollback: số bản ghi được sao ngược (mới hoặc đã đổi sau khi chuyển code) về collection cũ. */
  restored: number
}

export type ActivityLogSource = {
  kind: Exclude<ActivityLogKind, 'http'>
  collection: string
}

/** Bốn loại nhập vào `activity_logs`; loại `http` đã nằm sẵn trong collection này (chỉ gán kind). */
export const ACTIVITY_LOG_SOURCES: readonly ActivityLogSource[] = [
  { kind: 'blockchain', collection: 'blockchain_logs' },
  { kind: 'job-run', collection: 'job_run_histories' },
  { kind: 'recommendation', collection: 'recommendation_histories' },
  { kind: 'ai-consultation', collection: 'ai_consultation_logs' },
]

/**
 * Chỉ mục có tiền tố `kind` (mọi truy vấn mới lọc kind trước). Hai chỉ mục
 * `(createdAt)` và `(userId, createdAt)` của ActivityLog cũ đã có, không tạo lại.
 */
export const ACTIVITY_LOG_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
}> = [
  { name: 'activity_logs_kind_created_at', keys: { kind: 1, createdAt: 1 } },
  {
    name: 'activity_logs_kind_user_created_at',
    keys: { kind: 1, userId: 1, createdAt: 1 },
  },
  {
    name: 'activity_logs_kind_job_started',
    keys: { kind: 1, jobName: 1, startedAt: 1 },
  },
  {
    name: 'activity_logs_kind_contract_created',
    keys: { kind: 1, contractId: 1, createdAt: 1 },
  },
  {
    name: 'activity_logs_kind_payment_created',
    keys: { kind: 1, paymentId: 1, createdAt: 1 },
  },
  {
    name: 'activity_logs_kind_deposit_created',
    keys: { kind: 1, depositId: 1, createdAt: 1 },
  },
  {
    name: 'activity_logs_kind_governance_created',
    keys: { kind: 1, governanceSnapshotId: 1, createdAt: 1 },
  },
  { name: 'activity_logs_kind_tx_hash', keys: { kind: 1, txHash: 1 } },
  { name: 'activity_logs_kind_log_id', keys: { kind: 1, logId: 1 } },
]

function newReport(dryRun: boolean): ActivityLogMigrationReport {
  const zero = (): ActivityLogCount => ({ source: 0, target: 0 })
  return {
    migrationId: ACTIVITY_LOGS_MERGE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    restored: 0,
    counts: {
      http: zero(),
      'job-run': zero(),
      recommendation: zero(),
      blockchain: zero(),
      'ai-consultation': zero(),
      // `config-audit` do migration 031; 023 không sao chép loại này.
      'config-audit': zero(),
    },
  }
}

/** Đọc `collection` theo lô, sắp `_id` tăng dần; không bao giờ đọc cả collection một lần. */
async function forEachBatch(
  collection: ActivityLogMongoCollection,
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

/**
 * Gom log vào `activity_logs` với `kind` (giữ `_id` cũ, idempotent theo `_id`):
 * 1. dòng ActivityLog cũ chưa có `kind` được gán `kind: 'http'`;
 * 2. bốn collection log được sao sang theo lô, mỗi lô kiểm đếm `_id $in` ngay sau khi ghi;
 *    `_id` đã có ở đích với kind khác thì không ghi dòng đó, báo vào errors;
 * 3. tạo chỉ mục có tiền tố `kind`.
 * Không xóa/sửa collection cũ. `dryRun` (mặc định) chỉ đọc và đếm.
 */
export async function migrateActivityLogs(
  database: ActivityLogMongoDatabase,
  options: ActivityLogMigrationOptions = { dryRun: true }
): Promise<ActivityLogMigrationReport> {
  const dryRun = options.dryRun ?? true
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const report = newReport(dryRun)
  const target = database.collection(ACTIVITY_LOGS_COLLECTION)

  let httpSource = 0
  await forEachBatch(
    target,
    { kind: { $exists: false } },
    batchSize,
    async docs => {
      report.scanned += docs.length
      httpSource += docs.length
      report.updated += docs.length
      if (dryRun) return
      for (const doc of docs) {
        await target.updateOne({ _id: doc._id }, { $set: { kind: 'http' } })
      }
    }
  )
  report.counts.http.source = httpSource

  for (const source of ACTIVITY_LOG_SOURCES) {
    const legacy = database.collection(source.collection)
    let sourceCount = 0
    await forEachBatch(legacy, {}, batchSize, async docs => {
      sourceCount += docs.length
      report.scanned += docs.length
      const ids = docs.map(doc => doc._id)
      const existing = await target.find({ _id: { $in: ids } }).toArray()
      const existingById = new Map(existing.map(d => [String(d._id), d]))
      const pending: Doc[] = []
      for (const doc of docs) {
        const current = existingById.get(String(doc._id))
        if (!current) {
          pending.push(doc)
          continue
        }
        if (current.kind !== source.kind) {
          report.errors.push(
            `${source.collection}:${String(doc._id)} trùng _id với bản ghi kind=${String(current.kind)}`
          )
          continue
        }
        report.skipped += 1
      }
      report.updated += pending.length
      if (dryRun) return
      // Dòng xung đột đã bị loại khỏi `pending` và báo vào errors (không checkpoint).
      for (const doc of pending) {
        const { _id, ...rest } = doc
        await target.updateOne(
          { _id },
          { $setOnInsert: { ...rest, kind: source.kind } },
          { upsert: true }
        )
      }
      const found = await target.countDocuments({
        kind: source.kind,
        _id: { $in: ids },
      })
      if (found !== ids.length) {
        throw new Error(
          `${ACTIVITY_LOGS_MERGE_MIGRATION_ID}: count mismatch for kind ${source.kind} ` +
            `(expected ${ids.length}, found ${found})`
        )
      }
    })
    report.counts[source.kind].source = sourceCount
    report.counts[source.kind].target = await target.countDocuments({
      kind: source.kind,
    })
  }

  if (!dryRun) {
    for (const index of ACTIVITY_LOG_INDEXES) {
      await target.createIndex(index.keys, { name: index.name })
    }
  }
  report.counts.http.target = await target.countDocuments({ kind: 'http' })

  return report
}

/** Dừng rollback của một loại khi kiểm đếm sau khi sao ngược lệch; loại đó được giữ nguyên. */
class KindRollbackHalted extends Error {}

/**
 * Rollback (dry-run mặc định), theo từng loại (ngược với chuyển):
 * 1. mỗi lô bản ghi của loại đó được sao ngược về collection cũ, chỉ các trường của hình cũ
 *    (`LEGACY_LOG_FIELDS`), ghi đè nếu đã có `_id` (giữ thay đổi sau chuyển code), chèn nếu chưa;
 * 2. kiểm đếm `_id $in` của lô; lệch thì báo lỗi và GIỮ loại đó trong activity_logs;
 * 3. xóa lô khỏi activity_logs;
 * 4. bỏ kind của dòng `http` (trả về hình ActivityLog cũ), rồi bỏ chỉ mục có tiền tố kind.
 * Không xóa/sửa bản ghi sẵn có của collection cũ ngoài việc ghi đè theo `_id`.
 */
export async function rollbackActivityLogs(
  database: ActivityLogMongoDatabase,
  options: ActivityLogMigrationOptions = { dryRun: true }
): Promise<ActivityLogMigrationReport> {
  const dryRun = options.dryRun ?? true
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const report = newReport(dryRun)
  const target = database.collection(ACTIVITY_LOGS_COLLECTION)

  for (const source of ACTIVITY_LOG_SOURCES) {
    const legacy = database.collection(source.collection)
    const fields = LEGACY_LOG_FIELDS[source.kind]
    report.counts[source.kind].source = await legacy.countDocuments({})
    try {
      await forEachBatch(
        target,
        { kind: source.kind },
        batchSize,
        async rows => {
          report.scanned += rows.length
          report.restored += rows.length
          report.updated += rows.length
          if (dryRun) return
          const ids = rows.map(row => row._id)
          const legacyExisting = await legacy
            .find({ _id: { $in: ids } })
            .toArray()
          const existingIds = new Set(legacyExisting.map(d => String(d._id)))
          for (const row of rows) {
            const legacyDoc = pickLegacyFields<Doc>(row, fields)
            if (existingIds.has(String(row._id))) {
              await legacy.replaceOne({ _id: row._id }, legacyDoc)
            } else {
              const { _id, ...insert } = legacyDoc
              await legacy.updateOne(
                { _id },
                { $setOnInsert: insert },
                { upsert: true }
              )
            }
          }
          const have = await legacy.countDocuments({ _id: { $in: ids } })
          if (have !== rows.length) {
            report.errors.push(
              `${source.collection}: ${have}/${rows.length} rows restored; ` +
                `${ACTIVITY_LOGS_COLLECTION} kind=${source.kind} kept`
            )
            throw new KindRollbackHalted()
          }
          await target.deleteMany({ _id: { $in: ids }, kind: source.kind })
        }
      )
    } catch (error) {
      if (!(error instanceof KindRollbackHalted)) throw error
    }
    report.counts[source.kind].target = await target.countDocuments({
      kind: source.kind,
    })
  }

  report.counts.http.source = await target.countDocuments({ kind: 'http' })
  await forEachBatch(target, { kind: 'http' }, batchSize, async rows => {
    report.scanned += rows.length
    report.updated += rows.length
    if (dryRun) return
    for (const row of rows) {
      await target.updateOne({ _id: row._id }, { $unset: { kind: '' } })
    }
  })
  report.counts.http.target = await target.countDocuments({ kind: 'http' })

  if (!dryRun && report.errors.length === 0) {
    for (const index of ACTIVITY_LOG_INDEXES) {
      try {
        await target.dropIndex(index.name)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
  }

  return report
}
