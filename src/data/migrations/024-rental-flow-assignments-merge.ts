import type { MigrationOptions, MigrationReport } from './migration.types'

export const RENTAL_FLOW_ASSIGNMENTS_MERGE_MIGRATION_ID =
  '024-rental-flow-assignments-merge'

export const RENTAL_FLOW_CONFIGS_COLLECTION = 'rental_flow_configs'
export const RENTAL_FLOW_ASSIGNMENTS_COLLECTION = 'rental_flow_assignments'
export const RENTAL_FLOW_ASSIGNMENT_KIND = 'assignment'

type Doc = Record<string, unknown> & { _id: unknown }

export type RentalFlowAssignmentIndexOptions = {
  name?: string
  partialFilterExpression?: Record<string, unknown>
}

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface RentalFlowAssignmentMongoCollection {
  find(filter?: Record<string, unknown>): { toArray(): Promise<Doc[]> }
  countDocuments(filter?: Record<string, unknown>): Promise<number>
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<{ upsertedCount?: number }>
  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>
  ): Promise<{ matchedCount?: number }>
  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount?: number }>
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: RentalFlowAssignmentIndexOptions
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export interface RentalFlowAssignmentMongoDatabase {
  collection(name: string): RentalFlowAssignmentMongoCollection
}

export type RentalFlowAssignmentMigrationReport = MigrationReport & {
  counts: { source: number; target: number }
  /** Rollback: số bản ghi được sao ngược (mới hoặc đã đổi sau khi chuyển code) về collection cũ. */
  restored: number
  /** Cảnh báo dữ liệu bẩn (không làm dừng migration, không mất dòng nào). */
  warnings: string[]
}

/**
 * Chỉ mục của kind assignment. Chỉ mục `(kind, key)` là THƯỜNG (không unique): collection cũ
 * không có unique `assignmentId` và dữ liệu thật có bản ghi trùng `assignmentId`, nên việc
 * sao chép giữ nguyên mọi dòng và không ép unique ở đích. Partial theo kind 'assignment'
 * nên profile/policy không bị ảnh hưởng.
 */
export const RENTAL_FLOW_ASSIGNMENT_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
  partialFilterExpression?: Record<string, unknown>
}> = [
  {
    name: 'rental_flow_configs_assignment_key',
    keys: { kind: 1, key: 1 },
    partialFilterExpression: { kind: RENTAL_FLOW_ASSIGNMENT_KIND },
  },
  {
    name: 'rental_flow_configs_assignment_scope_superseded',
    keys: { kind: 1, scope: 1, scopeValue: 1, supersededAt: 1 },
  },
]

/**
 * Ánh xạ bản ghi cũ sang RentalFlowConfig (không gồm `_id`): assignmentId -> key, thêm kind.
 * Thiếu `assignmentId` thì không bịa `key` (trường được bỏ qua, không ghi null).
 */
export function toRentalFlowConfigAssignmentDoc(
  legacy: Doc
): Record<string, unknown> {
  const { _id: _unused, assignmentId, ...rest } = legacy
  void _unused
  if (assignmentId === undefined) {
    return { ...rest, kind: RENTAL_FLOW_ASSIGNMENT_KIND }
  }
  return { ...rest, kind: RENTAL_FLOW_ASSIGNMENT_KIND, key: assignmentId }
}

/** Ánh xạ ngược: bỏ `kind`, `key` -> assignmentId (không gồm `_id`; không bịa khi thiếu key). */
export function fromRentalFlowConfigAssignmentDoc(
  row: Doc
): Record<string, unknown> {
  const { _id: _unused, kind: _kind, key, ...rest } = row
  void _unused
  void _kind
  if (key === undefined) return rest
  return { ...rest, assignmentId: key }
}

function newReport(dryRun: boolean): RentalFlowAssignmentMigrationReport {
  return {
    migrationId: RENTAL_FLOW_ASSIGNMENTS_MERGE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    restored: 0,
    warnings: [],
    counts: { source: 0, target: 0 },
  }
}

/**
 * Sao `rental_flow_assignments` sang `rental_flow_configs` (kind 'assignment') theo `_id`
 * (giữ `_id` cũ, idempotent), rồi tạo chỉ mục. Không xóa/sửa collection cũ, không dedup:
 * mọi dòng nguồn (kể cả trùng `assignmentId`) đều được sao đủ.
 * `dryRun` mặc định: chỉ đọc và đếm. Bản ghi thiếu hoặc sai kiểu `assignmentId` được
 * sao nguyên và chỉ ghi cảnh báo. Dòng xung đột (cùng `_id` khác kind ở đích hoặc trùng giữa hai nguồn) không được ghi, chỉ báo vào `errors` (không checkpoint); các dòng còn lại vẫn được sao. Sau khi ghi, mọi `_id` nguồn phải có mặt ở đích với kind 'assignment',
 * lệch thì ném lỗi.
 */
export async function migrateRentalFlowAssignments(
  database: RentalFlowAssignmentMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<RentalFlowAssignmentMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(RENTAL_FLOW_CONFIGS_COLLECTION)
  const legacyDocs = await database
    .collection(RENTAL_FLOW_ASSIGNMENTS_COLLECTION)
    .find()
    .toArray()
  report.scanned = legacyDocs.length
  report.counts.source = legacyDocs.length

  const plan: Array<{ legacy: Doc; exists: boolean }> = []
  const expectedIds: unknown[] = []

  for (const legacy of legacyDocs) {
    const label = `${RENTAL_FLOW_ASSIGNMENTS_COLLECTION}:${String(legacy._id)}`
    if (typeof legacy.assignmentId !== 'string') {
      report.warnings.push(
        `${label} thiếu hoặc sai kiểu assignmentId: giữ nguyên giá trị gốc`
      )
    }

    const existing = await target.find({ _id: legacy._id }).toArray()
    const other = existing.find(d => d.kind !== RENTAL_FLOW_ASSIGNMENT_KIND)
    if (other) {
      report.errors.push(
        `${label} trùng _id với bản ghi đích kind=${String(other.kind)}`
      )
      continue
    }

    expectedIds.push(legacy._id)
    plan.push({ legacy, exists: existing.length > 0 })
  }

  for (const item of plan) {
    if (item.exists) {
      report.skipped += 1
      continue
    }
    report.updated += 1
    if (!dryRun) {
      await target.updateOne(
        { _id: item.legacy._id },
        { $setOnInsert: toRentalFlowConfigAssignmentDoc(item.legacy) },
        { upsert: true }
      )
    }
  }

  report.counts.target = await target.countDocuments({
    kind: RENTAL_FLOW_ASSIGNMENT_KIND,
  })
  // Đích có thể nhiều hơn do ghi mới sau khi chuyển code, nên kiểm theo `_id` nguồn.
  if (!dryRun) {
    const found = await target.countDocuments({
      kind: RENTAL_FLOW_ASSIGNMENT_KIND,
      _id: { $in: expectedIds },
    })
    if (found !== expectedIds.length) {
      throw new Error(
        `${RENTAL_FLOW_ASSIGNMENTS_MERGE_MIGRATION_ID}: count mismatch for kind ${RENTAL_FLOW_ASSIGNMENT_KIND} ` +
          `(expected ${expectedIds.length}, found ${found})`
      )
    }
    for (const index of RENTAL_FLOW_ASSIGNMENT_INDEXES) {
      const { name, keys, ...rest } = index
      await target.createIndex(keys, { name, ...rest })
    }
  }

  return report
}

/**
 * Rollback (dry-run mặc định), sao ngược mọi bản ghi kind 'assignment':
 * 1. `_id` có ở collection cũ: `replaceOne` bằng bản ở đích (assignmentId = key, bỏ `kind`),
 *    để trạng thái đổi sau khi chuyển code (vd. supersededAt) không bị mất;
 * 2. `_id` chỉ có ở đích (tạo sau khi chuyển code): chèn vào collection cũ;
 * 3. chỉ khi collection cũ chứa đủ các `_id` đã sao ngược mới xóa kind 'assignment'
 *    khỏi `rental_flow_configs` (lệch thì báo lỗi, giữ nguyên dữ liệu và chỉ mục);
 * 4. bỏ hai chỉ mục của kind 'assignment'.
 * Bản ghi chỉ có ở collection cũ được giữ nguyên, tính vào `skipped`.
 * `updated` = số bản ghi bị xóa khỏi đích (hoặc sẽ bị xóa khi dry-run);
 * `restored` = số bản ghi ghi ngược về collection cũ.
 */
export async function rollbackRentalFlowAssignments(
  database: RentalFlowAssignmentMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<RentalFlowAssignmentMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(RENTAL_FLOW_CONFIGS_COLLECTION)
  const legacy = database.collection(RENTAL_FLOW_ASSIGNMENTS_COLLECTION)

  const legacyDocs = await legacy.find().toArray()
  const legacyIds = new Set(legacyDocs.map(d => String(d._id)))
  report.scanned = legacyDocs.length
  report.counts.source = legacyDocs.length

  const rows = await target
    .find({ kind: RENTAL_FLOW_ASSIGNMENT_KIND })
    .toArray()
  const rowIds = new Set(rows.map(r => String(r._id)))
  for (const doc of legacyDocs) {
    if (!rowIds.has(String(doc._id))) report.skipped += 1
  }
  report.counts.target = rows.length
  report.restored = rows.length
  report.updated = rows.length
  if (dryRun) return report

  for (const row of rows) {
    const legacyDoc = fromRentalFlowConfigAssignmentDoc(row)
    if (legacyIds.has(String(row._id))) {
      await legacy.replaceOne({ _id: row._id }, legacyDoc)
    } else {
      await legacy.updateOne(
        { _id: row._id },
        { $setOnInsert: legacyDoc },
        { upsert: true }
      )
    }
  }

  const have = await legacy.countDocuments({
    _id: { $in: rows.map(r => r._id) },
  })
  if (have !== rows.length) {
    report.errors.push(
      `${RENTAL_FLOW_ASSIGNMENTS_COLLECTION}: ${have}/${rows.length} rows restored; ` +
        `${RENTAL_FLOW_CONFIGS_COLLECTION} kind=${RENTAL_FLOW_ASSIGNMENT_KIND} kept`
    )
    report.updated = 0
    report.restored = have
    report.counts.target = rows.length
    return report
  }

  await target.deleteMany({ kind: RENTAL_FLOW_ASSIGNMENT_KIND })
  report.counts.target = await target.countDocuments({
    kind: RENTAL_FLOW_ASSIGNMENT_KIND,
  })

  for (const index of RENTAL_FLOW_ASSIGNMENT_INDEXES) {
    try {
      await target.dropIndex(index.name)
    } catch {
      // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
    }
  }

  return report
}
