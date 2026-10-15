import type { MigrationOptions, MigrationReport } from './migration.types'

export const RENTAL_FLOW_CONFIGS_MERGE_MIGRATION_ID =
  '014-rental-flow-configs-merge'

export const RENTAL_FLOW_CONFIGS_COLLECTION = 'rental_flow_configs'

export type RentalFlowConfigKindName = 'profile' | 'policy'

type Doc = Record<string, unknown> & { _id: unknown }

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface RentalFlowConfigMongoCollection {
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
    options?: { name?: string }
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export interface RentalFlowConfigMongoDatabase {
  collection(name: string): RentalFlowConfigMongoCollection
}

export type RentalFlowConfigKindCount = { source: number; target: number }

export type RentalFlowConfigMigrationReport = MigrationReport & {
  counts: Record<RentalFlowConfigKindName, RentalFlowConfigKindCount>
  /** Rollback: số bản ghi được sao ngược (mới hoặc đã đổi sau khi chuyển code) về collection cũ. */
  restored: number
}

export type RentalFlowConfigSource = {
  kind: RentalFlowConfigKindName
  collection: string
  /** Khóa nghiệp vụ của collection cũ, thành `key` ở collection mới. */
  keyField: 'profileId' | 'policyId'
}

export const RENTAL_FLOW_CONFIG_SOURCES: readonly RentalFlowConfigSource[] = [
  {
    kind: 'profile',
    collection: 'rental_flow_profiles',
    keyField: 'profileId',
  },
  {
    kind: 'policy',
    collection: 'rental_execution_policies',
    keyField: 'policyId',
  },
]

/** Hai entity cũ không có unique nào, nên chỉ cần chỉ mục thường cho mọi truy vấn theo khóa. */
export const RENTAL_FLOW_CONFIG_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
}> = [
  {
    name: 'rental_flow_configs_kind_key_status_version',
    keys: { kind: 1, key: 1, status: 1, version: 1 },
  },
]

/** Ánh xạ bản ghi cũ sang RentalFlowConfig (không gồm `_id`); mọi trường khác giữ nguyên. */
export function toRentalFlowConfigDoc(
  source: RentalFlowConfigSource,
  legacy: Doc
): Record<string, unknown> {
  const { _id: _unused, [source.keyField]: key, ...rest } = legacy
  void _unused
  return { kind: source.kind, key, ...rest }
}

/** Ánh xạ ngược: bỏ `kind`, `key` -> khóa nghiệp vụ cũ (không gồm `_id`). */
export function fromRentalFlowConfigDoc(
  source: RentalFlowConfigSource,
  row: Doc
): Record<string, unknown> {
  const { _id: _unused, kind: _kind, key, ...rest } = row
  void _unused
  void _kind
  return { [source.keyField]: key, ...rest }
}

function newReport(dryRun: boolean): RentalFlowConfigMigrationReport {
  return {
    migrationId: RENTAL_FLOW_CONFIGS_MERGE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    restored: 0,
    counts: {
      profile: { source: 0, target: 0 },
      policy: { source: 0, target: 0 },
    },
  }
}

/**
 * Sao `rental_flow_profiles` và `rental_execution_policies` sang `rental_flow_configs`
 * theo `_id` (giữ `_id` cũ, idempotent), rồi tạo chỉ mục. Không xóa/sửa collection cũ.
 * `dryRun` chỉ đọc và đếm. Khi áp dụng: bản ghi thiếu khóa nghiệp vụ, `_id` trùng giữa
 * hai nguồn, hoặc `_id` đã tồn tại ở đích với `kind` khác đều làm dừng TRƯỚC khi ghi;
 * sau khi ghi, mọi `_id` nguồn phải có mặt ở đích đúng `kind`, lệch thì ném lỗi.
 */
export async function migrateRentalFlowConfigs(
  database: RentalFlowConfigMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<RentalFlowConfigMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(RENTAL_FLOW_CONFIGS_COLLECTION)
  const plan: Array<{
    source: RentalFlowConfigSource
    legacy: Doc
    exists: boolean
  }> = []
  const expectedByKind: Record<RentalFlowConfigKindName, unknown[]> = {
    profile: [],
    policy: [],
  }
  const seenIds = new Map<string, RentalFlowConfigKindName>()

  for (const source of RENTAL_FLOW_CONFIG_SOURCES) {
    const legacyDocs = await database
      .collection(source.collection)
      .find()
      .toArray()
    report.counts[source.kind].source = legacyDocs.length
    for (const legacy of legacyDocs) {
      report.scanned += 1
      const label = `${source.collection}:${String(legacy._id)}`
      if (typeof legacy[source.keyField] !== 'string') {
        report.errors.push(`${label} thiếu ${source.keyField}`)
        continue
      }
      const idKey = String(legacy._id)
      const previous = seenIds.get(idKey)
      if (previous !== undefined) {
        report.errors.push(`${label} trùng _id với nguồn kind=${previous}`)
        continue
      }
      seenIds.set(idKey, source.kind)
      const existing = await target.find({ _id: legacy._id }).toArray()
      const other = existing.find(d => d.kind !== source.kind)
      if (other) {
        report.errors.push(
          `${label} trùng _id với bản ghi đích kind=${String(other.kind)}`
        )
        continue
      }
      expectedByKind[source.kind].push(legacy._id)
      plan.push({ source, legacy, exists: existing.length > 0 })
    }
  }

  if (!dryRun && report.errors.length > 0) {
    throw new Error(
      `${RENTAL_FLOW_CONFIGS_MERGE_MIGRATION_ID}: refusing to apply, ` +
        `${report.errors.length} invalid source rows: ${report.errors.join('; ')}`
    )
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
        {
          $setOnInsert: toRentalFlowConfigDoc(item.source, item.legacy),
        },
        { upsert: true }
      )
    }
  }

  for (const source of RENTAL_FLOW_CONFIG_SOURCES) {
    const count = report.counts[source.kind]
    count.target = await target.countDocuments({ kind: source.kind })
    // Đích có thể nhiều hơn do ghi mới sau khi chuyển code, nên kiểm theo `_id` nguồn.
    if (!dryRun) {
      const expectedIds = expectedByKind[source.kind]
      const found = await target.countDocuments({
        kind: source.kind,
        _id: { $in: expectedIds },
      })
      if (found !== expectedIds.length) {
        throw new Error(
          `${RENTAL_FLOW_CONFIGS_MERGE_MIGRATION_ID}: count mismatch for kind ${source.kind} ` +
            `(expected ${expectedIds.length}, found ${found})`
        )
      }
    }
  }

  if (!dryRun) {
    for (const index of RENTAL_FLOW_CONFIG_INDEXES) {
      await target.createIndex(index.keys, { name: index.name })
    }
  }

  return report
}

/**
 * Rollback (dry-run mặc định), theo từng kind:
 * 1. `_id` có ở cả hai bên: `replaceOne` bản cũ bằng bản ở đích (key -> khóa cũ, bỏ `kind`),
 *    để trạng thái đổi sau khi chuyển code (xuất bản, lưu trữ, draftRevision) không bị mất;
 * 2. `_id` chỉ có ở đích (tạo sau khi chuyển code): chèn vào collection cũ;
 * 3. chỉ khi collection cũ chứa đủ các `_id` của kind đó mới xóa kind đó khỏi
 *    `rental_flow_configs` (lệch thì báo lỗi, giữ nguyên kind);
 * 4. bỏ chỉ mục.
 * Bản ghi chỉ có ở collection cũ (không có ở đích) được giữ nguyên, tính vào `skipped`.
 * `updated` = số bản ghi bị xóa khỏi đích (hoặc sẽ bị xóa khi dry-run);
 * `restored` = số bản ghi ghi ngược về collection cũ.
 */
export async function rollbackRentalFlowConfigs(
  database: RentalFlowConfigMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<RentalFlowConfigMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(RENTAL_FLOW_CONFIGS_COLLECTION)

  for (const source of RENTAL_FLOW_CONFIG_SOURCES) {
    const legacyCollection = database.collection(source.collection)
    const legacyDocs = await legacyCollection.find().toArray()
    const legacyIds = new Set(legacyDocs.map(d => String(d._id)))
    report.counts[source.kind].source = legacyDocs.length

    const rows = await target.find({ kind: source.kind }).toArray()
    const rowIds = new Set(rows.map(r => String(r._id)))
    for (const legacy of legacyDocs) {
      report.scanned += 1
      if (!rowIds.has(String(legacy._id))) report.skipped += 1
    }

    report.restored += rows.length
    report.updated += rows.length
    if (dryRun) continue

    for (const row of rows) {
      const legacyDoc = fromRentalFlowConfigDoc(source, row)
      if (legacyIds.has(String(row._id))) {
        await legacyCollection.replaceOne({ _id: row._id }, legacyDoc)
      } else {
        await legacyCollection.updateOne(
          { _id: row._id },
          { $setOnInsert: legacyDoc },
          { upsert: true }
        )
      }
    }
    const have = await legacyCollection.countDocuments({
      _id: { $in: rows.map(r => r._id) },
    })
    if (have !== rows.length) {
      report.errors.push(
        `${source.collection}: ${have}/${rows.length} rows restored; ` +
          `${RENTAL_FLOW_CONFIGS_COLLECTION} kind=${source.kind} kept`
      )
      report.updated -= rows.length
      report.restored -= rows.length - have
      continue
    }
    await target.deleteMany({ kind: source.kind })
  }

  for (const source of RENTAL_FLOW_CONFIG_SOURCES) {
    report.counts[source.kind].target = await target.countDocuments({
      kind: source.kind,
    })
  }

  if (!dryRun && report.errors.length === 0) {
    for (const index of RENTAL_FLOW_CONFIG_INDEXES) {
      try {
        await target.dropIndex(index.name)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
  }

  return report
}
