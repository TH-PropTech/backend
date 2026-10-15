import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-CFG: hợp nhất `job_configs` và `recommendation_configs` vào `system_configs{scope}`.
 * (Không gồm `groq_api_keys` và `platform_fee_schedules`: giữ riêng.)
 *
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - Giữ `_id` cũ; idempotent (bản ghi đã có theo `_id` bị bỏ qua).
 * - `recommendation_configs` không có unique: nếu một `configId` có nhiều bản ghi thì chỉ
 *   sao bản đầu (đúng bản `findOne` cũ đọc), các bản còn lại liệt kê ở `duplicateIds`.
 * - Bản ghi đích đã có cùng `(scope, key)` nhưng khác `_id` (code đã chuyển trước khi
 *   migrate) được báo lỗi, không ghi đè.
 * - Kiểm đếm sau khi áp dụng theo `_id $in` đúng scope; lệch thì ném lỗi và dừng.
 *   Sau đó tạo chỉ mục unique `(scope, key)`.
 * - Không xóa collection cũ.
 * - Rollback sao ngược kể cả bản ghi tạo/đổi sau khi chuyển code về collection cũ
 *   (khớp theo `_id` rồi theo khóa), chỉ xóa scope khỏi `system_configs` khi đã sao đủ,
 *   rồi bỏ chỉ mục.
 */
export const MERGE_SYSTEM_CONFIGS_MIGRATION_ID = '013-merge-system-configs'

export const SYSTEM_CONFIGS_COLLECTION = 'system_configs'

export type SystemConfigScopeName = 'job' | 'recommendation'

type Doc = Record<string, unknown> & { _id: unknown }

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface SystemConfigMongoCollection {
  find(filter?: Record<string, unknown>): { toArray(): Promise<Doc[]> }
  countDocuments(filter?: Record<string, unknown>): Promise<number>
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<unknown>
  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount?: number }>
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: { name?: string; unique?: boolean }
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export interface SystemConfigMongoDatabase {
  collection(name: string): SystemConfigMongoCollection
}

export type SystemConfigScopeCount = { source: number; target: number }

export type SystemConfigMigrationReport = MigrationReport & {
  counts: Record<SystemConfigScopeName, SystemConfigScopeCount>
  /** Bản ghi nguồn trùng khóa (chỉ bản đầu được sao). */
  duplicateIds: string[]
  /** Rollback: số bản ghi sao ngược/cập nhật về collection cũ. */
  restored: number
}

export type SystemConfigSource = {
  scope: SystemConfigScopeName
  collection: string
  keyField: string
  /** Trường dữ liệu (ngoài khóa và `_id`) được sao hai chiều. */
  fields: readonly string[]
  /** Giá trị khóa khi bản ghi cũ thiếu trường khóa. */
  defaultKey?: string
}

export const SYSTEM_CONFIG_SOURCES: readonly SystemConfigSource[] = [
  {
    scope: 'job',
    collection: 'job_configs',
    keyField: 'jobName',
    fields: ['enabled', 'createdAt', 'updatedAt'],
  },
  {
    scope: 'recommendation',
    collection: 'recommendation_configs',
    keyField: 'configId',
    fields: [
      'strategy',
      'alpha',
      'nbWeight',
      'ruleWeight',
      'updatedBy',
      'createdAt',
      'updatedAt',
    ],
    defaultKey: 'global',
  },
]

export const SYSTEM_CONFIG_INDEX = {
  name: 'system_configs_scope_key_unique',
  keys: { scope: 1, key: 1 } as Record<string, 1 | -1>,
}

function pick(source: Doc, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field]
  }
  return out
}

function keyOf(source: SystemConfigSource, legacy: Doc): string | null {
  const value = legacy[source.keyField] ?? source.defaultKey
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Bản ghi cũ -> `system_configs` (không gồm `_id`). Chỉ sao trường có mặt. */
export function toSystemConfigDoc(
  source: SystemConfigSource,
  legacy: Doc,
  key: string
): Record<string, unknown> {
  return { scope: source.scope, key, ...pick(legacy, source.fields) }
}

/** `system_configs` -> hình collection cũ (không gồm `_id`). */
export function fromSystemConfigDoc(
  source: SystemConfigSource,
  row: Doc
): Record<string, unknown> {
  return { [source.keyField]: row.key, ...pick(row, source.fields) }
}

function newReport(dryRun: boolean): SystemConfigMigrationReport {
  return {
    migrationId: MERGE_SYSTEM_CONFIGS_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    duplicateIds: [],
    restored: 0,
    counts: {
      job: { source: 0, target: 0 },
      recommendation: { source: 0, target: 0 },
    },
  }
}

export async function migrateMergeSystemConfigs(
  database: SystemConfigMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<SystemConfigMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(SYSTEM_CONFIGS_COLLECTION)
  const expectedByScope = new Map<SystemConfigScopeName, unknown[]>()

  for (const source of SYSTEM_CONFIG_SOURCES) {
    const legacyDocs = await database
      .collection(source.collection)
      .find()
      .toArray()
    report.counts[source.scope].source = legacyDocs.length
    const expectedIds: unknown[] = []
    expectedByScope.set(source.scope, expectedIds)
    const seenKeys = new Set<string>()

    for (const legacy of legacyDocs) {
      report.scanned += 1
      const key = keyOf(source, legacy)
      if (key === null) {
        report.errors.push(
          `${source.collection}:${String(legacy._id)} thiếu ${source.keyField}`
        )
        continue
      }
      if (seenKeys.has(key)) {
        report.duplicateIds.push(`${source.collection}:${String(legacy._id)}`)
        report.skipped += 1
        continue
      }
      seenKeys.add(key)

      if ((await target.countDocuments({ _id: legacy._id })) > 0) {
        expectedIds.push(legacy._id)
        report.skipped += 1
        continue
      }
      if ((await target.countDocuments({ scope: source.scope, key })) > 0) {
        report.errors.push(
          `${source.collection}:${String(legacy._id)} trùng (scope=${source.scope}, key=${key}) với bản ghi system_configs khác _id; không ghi đè`
        )
        continue
      }
      expectedIds.push(legacy._id)
      report.updated += 1
      if (!dryRun) {
        await target.updateOne(
          { _id: legacy._id },
          { $setOnInsert: toSystemConfigDoc(source, legacy, key) },
          { upsert: true }
        )
      }
    }
  }

  for (const source of SYSTEM_CONFIG_SOURCES) {
    report.counts[source.scope].target = await target.countDocuments({
      scope: source.scope,
    })
    // Sau khi áp dụng, mọi `_id` nguồn hợp lệ phải có mặt trong đích đúng scope
    // (đích có thể nhiều hơn do ghi mới nên không so tổng số). Lệch thì dừng.
    if (!dryRun) {
      const expectedIds = expectedByScope.get(source.scope) ?? []
      const found = await target.countDocuments({
        scope: source.scope,
        _id: { $in: expectedIds },
      })
      if (found !== expectedIds.length) {
        throw new Error(
          `${MERGE_SYSTEM_CONFIGS_MIGRATION_ID}: count mismatch for scope ${source.scope} ` +
            `(expected ${expectedIds.length}, found ${found})`
        )
      }
    }
  }

  if (!dryRun) {
    await target.createIndex(SYSTEM_CONFIG_INDEX.keys, {
      name: SYSTEM_CONFIG_INDEX.name,
      unique: true,
    })
  }

  return report
}

/**
 * Rollback (dry-run mặc định), theo từng scope: mỗi bản ghi `system_configs` được
 * ghi lại vào collection cũ (khớp `_id`, rồi khớp khóa; không có thì chèn với `_id` đó):
 * trạng thái đổi và bản ghi tạo sau khi chuyển code đều được giữ. Chỉ khi collection cũ
 * đã chứa đủ khóa thì mới xóa scope khỏi `system_configs`; lệch thì báo lỗi và giữ scope.
 * Cuối cùng bỏ chỉ mục (nếu không có lỗi). `updated` = số bản ghi bị xóa khỏi
 * `system_configs` (hoặc sẽ bị xóa khi dry-run); `restored` = số bản ghi sao ngược.
 */
export async function rollbackMergeSystemConfigs(
  database: SystemConfigMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<SystemConfigMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(SYSTEM_CONFIGS_COLLECTION)

  for (const source of SYSTEM_CONFIG_SOURCES) {
    const legacyCollection = database.collection(source.collection)
    const legacyDocs = await legacyCollection.find().toArray()
    report.counts[source.scope].source = legacyDocs.length
    const rows = await target.find({ scope: source.scope }).toArray()
    report.scanned += rows.length
    report.restored += rows.length
    report.updated += rows.length
    if (dryRun) continue

    const legacyById = new Map(legacyDocs.map(d => [String(d._id), d]))
    const legacyByKey = new Map<string, Doc>()
    for (const d of legacyDocs) {
      const key = keyOf(source, d)
      if (key !== null && !legacyByKey.has(key)) legacyByKey.set(key, d)
    }

    for (const row of rows) {
      const body = fromSystemConfigDoc(source, row)
      const match =
        legacyById.get(String(row._id)) ?? legacyByKey.get(String(row.key))
      if (match) {
        const { [source.keyField]: _key, createdAt: _created, ...state } = body
        void _key
        void _created
        await legacyCollection.updateOne({ _id: match._id }, { $set: state })
      } else {
        await legacyCollection.updateOne(
          { _id: row._id },
          { $setOnInsert: body },
          { upsert: true }
        )
      }
    }

    const after = await legacyCollection.find().toArray()
    const afterKeys = new Set(
      after.map(d => keyOf(source, d)).filter((k): k is string => k !== null)
    )
    const lacking = rows.filter(r => !afterKeys.has(String(r.key)))
    if (lacking.length > 0) {
      report.errors.push(
        `${source.collection}: ${lacking.length}/${rows.length} config rows not restored; ` +
          `${SYSTEM_CONFIGS_COLLECTION} scope=${source.scope} kept`
      )
      report.updated -= rows.length
      report.restored -= lacking.length
      continue
    }
    await target.deleteMany({ scope: source.scope })
  }

  for (const source of SYSTEM_CONFIG_SOURCES) {
    report.counts[source.scope].target = await target.countDocuments({
      scope: source.scope,
    })
  }

  if (!dryRun && report.errors.length === 0) {
    try {
      await target.dropIndex(SYSTEM_CONFIG_INDEX.name)
    } catch {
      // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
    }
  }

  return report
}
