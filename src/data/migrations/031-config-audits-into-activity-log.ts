import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * Gom `config_audits` (ConfigAudit cũ, 4 scope) vào `activity_logs` với `kind: 'config-audit'`.
 *
 * - Mặc định chạy thử (dry-run). Chỉ ghi khi truyền `{ dryRun: false }`.
 * - Giữ `_id` cũ. Không xóa, không sửa `config_audits`.
 * - Idempotent theo `_id`: đã có ở đích cùng kind thì bỏ qua.
 * - KHÔNG giả định unique: bản ghi giống nhau (khác `_id`) đều được sao, không khử trùng.
 * - Xung đột: `_id` đã tồn tại ở đích với kind khác. Pha 1 (chỉ đọc) quét TOÀN BỘ nguồn
 *   trước; dòng xung đột KHÔNG được ghi và được báo vào `errors` (không checkpoint),
 *   các dòng còn lại vẫn được sao.
 * - Pha 2 ghi theo lô (sắp `_id`), mỗi lô kiểm đếm `_id $in` ngay sau khi ghi.
 * - Chỉ mục có tiền tố `kind` được tạo SAU KHI mọi lô đã kiểm đếm đủ.
 * - Rollback sao ngược kể cả bản ghi ghi sau chuyển code, theo lô; chỉ `$unset`/xóa
 *   khỏi `activity_logs` khi lô đã kiểm đếm đủ; chỉ bỏ chỉ mục khi không có lỗi.
 */
export const CONFIG_AUDITS_INTO_ACTIVITY_LOG_MIGRATION_ID =
  '031-config-audits-into-activity-log'

export const CONFIG_AUDIT_KIND = 'config-audit'
export const CONFIG_AUDITS_COLLECTION = 'config_audits'
export const ACTIVITY_LOGS_COLLECTION = 'activity_logs'

/** Trường của ConfigAudit cũ (khớp `LEGACY_LOG_FIELDS['config-audit']`). */
const LEGACY_FIELDS = [
  '_id',
  'scope',
  'key',
  'version',
  'action',
  'actorId',
  'reason',
  'beforeHash',
  'afterHash',
  'targetType',
  'details',
  'createdAt',
] as const

/** Chỉ mục có tiền tố `kind` (khớp `@Index` của `ActivityLog`). */
export const CONFIG_AUDIT_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
}> = [
  {
    name: 'activity_logs_kind_scope_key_version_created',
    keys: { kind: 1, scope: 1, key: 1, version: 1, createdAt: 1 },
  },
  {
    name: 'activity_logs_kind_scope_created',
    keys: { kind: 1, scope: 1, createdAt: 1 },
  },
]

/** Số bản ghi đọc/ghi mỗi lô; không bao giờ nạp cả collection vào bộ nhớ. */
const DEFAULT_BATCH_SIZE = 500

type Doc = Record<string, unknown> & { _id: unknown }

export interface ConfigAuditFindChain {
  sort(spec: Record<string, 1 | -1>): ConfigAuditFindChain
  limit(count: number): ConfigAuditFindChain
  toArray(): Promise<Doc[]>
}

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface ConfigAuditIntoActivityLogCollection {
  find(filter?: Record<string, unknown>): ConfigAuditFindChain
  countDocuments(filter?: Record<string, unknown>): Promise<number>
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<unknown>
  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<unknown>
  deleteMany(filter: Record<string, unknown>): Promise<unknown>
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: { name?: string }
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export interface ConfigAuditIntoActivityLogDatabase {
  collection(name: string): ConfigAuditIntoActivityLogCollection
}

export type ConfigAuditIntoActivityLogOptions = MigrationOptions & {
  batchSize?: number
}

export type ConfigAuditIntoActivityLogReport = MigrationReport & {
  /** Số bản ghi `config_audits` (chuyển) hoặc `activity_logs` kind config-audit (rollback). */
  source: number
  /** Số bản ghi `activity_logs` có kind config-audit sau khi chạy. */
  target: number
  /** Rollback: số bản ghi được sao ngược về `config_audits`. */
  restored: number
}

function newReport(dryRun: boolean): ConfigAuditIntoActivityLogReport {
  return {
    migrationId: CONFIG_AUDITS_INTO_ACTIVITY_LOG_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    source: 0,
    target: 0,
    restored: 0,
  }
}

/** Đọc `collection` theo lô, sắp `_id` tăng dần. */
async function forEachBatch(
  collection: ConfigAuditIntoActivityLogCollection,
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

function pickLegacy(row: Doc): Record<string, unknown> {
  return Object.fromEntries(
    LEGACY_FIELDS.filter(field => row[field] !== undefined).map(field => [
      field,
      row[field],
    ])
  )
}

export async function migrateConfigAuditsIntoActivityLog(
  database: ConfigAuditIntoActivityLogDatabase,
  options: ConfigAuditIntoActivityLogOptions = { dryRun: true }
): Promise<ConfigAuditIntoActivityLogReport> {
  const dryRun = options.dryRun ?? true
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const report = newReport(dryRun)
  const legacy = database.collection(CONFIG_AUDITS_COLLECTION)
  const target = database.collection(ACTIVITY_LOGS_COLLECTION)

  // Pha 1 (chỉ đọc): đếm và tìm xung đột trên TOÀN BỘ nguồn trước khi ghi lô nào.
  // Dòng xung đột không được ghi (chỉ báo vào errors, không checkpoint).
  const conflictIds = new Set<string>()
  await forEachBatch(legacy, {}, batchSize, async docs => {
    report.scanned += docs.length
    report.source += docs.length
    const existing = await target
      .find({ _id: { $in: docs.map(d => d._id) } })
      .toArray()
    const existingById = new Map(existing.map(d => [String(d._id), d]))
    for (const doc of docs) {
      const current = existingById.get(String(doc._id))
      if (!current) {
        report.updated += 1
      } else if (current.kind !== CONFIG_AUDIT_KIND) {
        conflictIds.add(String(doc._id))
        report.errors.push(
          `${CONFIG_AUDITS_COLLECTION}:${String(doc._id)} trùng _id với bản ghi kind=${String(current.kind)}`
        )
      } else {
        report.skipped += 1
      }
    }
  })

  if (!dryRun) {
    // Pha 2 (ghi theo lô): upsert theo `_id`, kiểm đếm ngay sau mỗi lô.
    await forEachBatch(legacy, {}, batchSize, async allDocs => {
      const docs = allDocs.filter(d => !conflictIds.has(String(d._id)))
      for (const doc of docs) {
        const { _id, ...insert } = pickLegacy(doc)
        await target.updateOne(
          { _id },
          { $setOnInsert: { ...insert, kind: CONFIG_AUDIT_KIND } },
          { upsert: true }
        )
      }
      const ids = docs.map(d => d._id)
      const found = await target.countDocuments({
        kind: CONFIG_AUDIT_KIND,
        _id: { $in: ids },
      })
      if (found !== ids.length) {
        throw new Error(
          `${CONFIG_AUDITS_INTO_ACTIVITY_LOG_MIGRATION_ID}: count mismatch ` +
            `(expected ${ids.length}, found ${found})`
        )
      }
    })
    for (const index of CONFIG_AUDIT_INDEXES) {
      await target.createIndex(index.keys, { name: index.name })
    }
  }

  report.target = await target.countDocuments({ kind: CONFIG_AUDIT_KIND })
  return report
}

/** Dừng rollback khi kiểm đếm sau khi sao ngược lệch; mọi bản ghi của lô đó được giữ lại. */
class ConfigAuditRollbackHalted extends Error {}

/**
 * Rollback (dry-run mặc định), ngược với chuyển:
 * 1. mỗi lô bản ghi `kind: 'config-audit'` được sao về `config_audits` (chỉ trường của
 *    hình cũ, ghi đè nếu đã có `_id` để giữ thay đổi sau chuyển code, chèn nếu chưa có);
 * 2. kiểm đếm `_id $in` của lô; lệch thì báo lỗi, GIỮ lô đó trong activity_logs và dừng;
 * 3. xóa lô khỏi activity_logs (chỉ khi kind vẫn là config-audit);
 * 4. khi không có lỗi, bỏ các chỉ mục có tiền tố kind.
 * Bản ghi của loại khác không bị đụng tới.
 */
export async function rollbackConfigAuditsFromActivityLog(
  database: ConfigAuditIntoActivityLogDatabase,
  options: ConfigAuditIntoActivityLogOptions = { dryRun: true }
): Promise<ConfigAuditIntoActivityLogReport> {
  const dryRun = options.dryRun ?? true
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const report = newReport(dryRun)
  const legacy = database.collection(CONFIG_AUDITS_COLLECTION)
  const target = database.collection(ACTIVITY_LOGS_COLLECTION)

  report.source = await target.countDocuments({ kind: CONFIG_AUDIT_KIND })
  try {
    await forEachBatch(
      target,
      { kind: CONFIG_AUDIT_KIND },
      batchSize,
      async rows => {
        report.scanned += rows.length
        report.restored += rows.length
        report.updated += rows.length
        if (dryRun) return
        for (const row of rows) {
          await legacy.replaceOne({ _id: row._id }, pickLegacy(row), {
            upsert: true,
          })
        }
        const ids = rows.map(r => r._id)
        const have = await legacy.countDocuments({ _id: { $in: ids } })
        if (have !== rows.length) {
          report.errors.push(
            `${CONFIG_AUDITS_COLLECTION}: ${have}/${rows.length} rows restored; ` +
              `${ACTIVITY_LOGS_COLLECTION} kind=${CONFIG_AUDIT_KIND} kept`
          )
          throw new ConfigAuditRollbackHalted()
        }
        await target.deleteMany({ _id: { $in: ids }, kind: CONFIG_AUDIT_KIND })
      }
    )
  } catch (error) {
    if (!(error instanceof ConfigAuditRollbackHalted)) throw error
  }

  if (!dryRun && report.errors.length === 0) {
    for (const index of CONFIG_AUDIT_INDEXES) {
      try {
        await target.dropIndex(index.name)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
  }

  report.target = await target.countDocuments({ kind: CONFIG_AUDIT_KIND })
  return report
}
