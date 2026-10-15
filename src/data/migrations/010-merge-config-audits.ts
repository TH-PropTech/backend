import type { MigrationOptions, MigrationReport } from './migration.types'

export const MERGE_CONFIG_AUDITS_MIGRATION_ID = '010-merge-config-audits'

export const CONFIG_AUDITS_COLLECTION = 'config_audits'

export type ConfigAuditScopeName =
  | 'contract-layout'
  | 'contract-template'
  | 'platform-fee'
  | 'rental-flow'

type Doc = Record<string, unknown> & { _id: unknown }

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface AuditMongoCollection {
  find(filter?: Record<string, unknown>): { toArray(): Promise<Doc[]> }
  countDocuments(filter?: Record<string, unknown>): Promise<number>
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<{ upsertedCount?: number }>
  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount?: number }>
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: { name?: string }
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export interface ConfigAuditMongoDatabase {
  collection(name: string): AuditMongoCollection
}

export type ConfigAuditScopeCount = {
  source: number
  target: number
}

export type ConfigAuditMigrationReport = MigrationReport & {
  counts: Record<ConfigAuditScopeName, ConfigAuditScopeCount>
  /** Rollback: số audit ghi sau khi chuyển code được sao ngược về collection cũ. */
  restored: number
}

export type ConfigAuditSource = {
  scope: ConfigAuditScopeName
  collection: string
  keyField: string
  /** Trường riêng của collection cũ được dồn vào `details`. */
  detailFields: string[]
}

export const CONFIG_AUDIT_SOURCES: readonly ConfigAuditSource[] = [
  {
    scope: 'contract-layout',
    collection: 'contract_layout_audits',
    keyField: 'profileKey',
    detailFields: ['deniedField'],
  },
  {
    scope: 'contract-template',
    collection: 'contract_template_audits',
    keyField: 'templateKey',
    detailFields: ['reviewReference', 'deniedField', 'metadata'],
  },
  {
    scope: 'platform-fee',
    collection: 'platform_fee_audits',
    keyField: 'scheduleId',
    detailFields: ['changedFields'],
  },
  {
    scope: 'rental-flow',
    collection: 'rental_flow_audits',
    keyField: 'targetId',
    detailFields: [],
  },
]

export const CONFIG_AUDIT_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
}> = [
  {
    name: 'config_audits_scope_key_version_created',
    keys: { scope: 1, key: 1, version: 1, createdAt: 1 },
  },
  {
    name: 'config_audits_scope_created',
    keys: { scope: 1, createdAt: 1 },
  },
]

const COMMON_FIELDS = [
  'version',
  'action',
  'actorId',
  'reason',
  'beforeHash',
  'afterHash',
  'createdAt',
] as const

/**
 * Ánh xạ một bản ghi cũ sang ConfigAudit (không gồm `_id`, giữ nguyên `createdAt`).
 * Chỉ sao trường có mặt (khác undefined) để hình JSON đọc ngược khớp bản ghi cũ.
 */
export function toConfigAuditDoc(
  source: ConfigAuditSource,
  legacy: Doc
): Record<string, unknown> {
  const target: Record<string, unknown> = {
    scope: source.scope,
    key: legacy[source.keyField],
  }
  for (const field of COMMON_FIELDS) {
    if (legacy[field] !== undefined) target[field] = legacy[field]
  }
  if (source.scope === 'rental-flow') {
    if (legacy.targetType !== undefined) target.targetType = legacy.targetType
    if (legacy.details !== undefined) target.details = legacy.details
  } else {
    const details: Record<string, unknown> = {}
    for (const field of source.detailFields) {
      if (legacy[field] !== undefined) details[field] = legacy[field]
    }
    if (Object.keys(details).length > 0) target.details = details
  }
  return target
}

/**
 * Ánh xạ ngược một bản ghi `config_audits` về hình dạng collection cũ của
 * `source` (không gồm `_id`): `key` -> keyField, `details` -> trường riêng
 * (hoặc giữ `targetType`/`details` với rental-flow). Dùng cùng quy tắc với
 * `toConfigAuditDoc` (chỉ trường có mặt).
 */
export function fromConfigAuditDoc(
  source: ConfigAuditSource,
  audit: Doc
): Record<string, unknown> {
  const legacy: Record<string, unknown> = {}
  legacy[source.keyField] = audit.key
  for (const field of COMMON_FIELDS) {
    if (audit[field] !== undefined) legacy[field] = audit[field]
  }
  if (source.scope === 'rental-flow') {
    if (audit.targetType !== undefined) legacy.targetType = audit.targetType
    if (audit.details !== undefined) legacy.details = audit.details
  } else if (audit.details && typeof audit.details === 'object') {
    const details = audit.details as Record<string, unknown>
    for (const field of source.detailFields) {
      if (details[field] !== undefined) legacy[field] = details[field]
    }
  }
  return legacy
}

function newReport(dryRun: boolean): ConfigAuditMigrationReport {
  return {
    migrationId: MERGE_CONFIG_AUDITS_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    restored: 0,
    counts: {
      'contract-layout': { source: 0, target: 0 },
      'contract-template': { source: 0, target: 0 },
      'platform-fee': { source: 0, target: 0 },
      'rental-flow': { source: 0, target: 0 },
    },
  }
}

/**
 * Sao 4 collection audit cũ sang `config_audits` theo `_id` (idempotent, chạy lại không đổi gì),
 * rồi tạo chỉ mục. Không xóa/sửa collection cũ. `dryRun` chỉ đọc và đếm.
 */
export async function migrateMergeConfigAudits(
  database: ConfigAuditMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<ConfigAuditMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(CONFIG_AUDITS_COLLECTION)
  const expectedByScope = new Map<ConfigAuditScopeName, unknown[]>()

  for (const source of CONFIG_AUDIT_SOURCES) {
    const legacyDocs = await database
      .collection(source.collection)
      .find()
      .toArray()
    report.counts[source.scope].source = legacyDocs.length
    const expectedIds: unknown[] = []
    expectedByScope.set(source.scope, expectedIds)
    for (const legacy of legacyDocs) {
      report.scanned += 1
      if (typeof legacy[source.keyField] !== 'string') {
        report.errors.push(
          `${source.collection}:${String(legacy._id)} thiếu ${source.keyField}`
        )
        continue
      }
      expectedIds.push(legacy._id)
      if ((await target.countDocuments({ _id: legacy._id })) > 0) {
        report.skipped += 1
        continue
      }
      report.updated += 1
      if (!dryRun) {
        await target.updateOne(
          { _id: legacy._id },
          { $setOnInsert: toConfigAuditDoc(source, legacy) },
          { upsert: true }
        )
      }
    }
  }

  for (const source of CONFIG_AUDIT_SOURCES) {
    const count = report.counts[source.scope]
    count.target = await target.countDocuments({ scope: source.scope })
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
          `${MERGE_CONFIG_AUDITS_MIGRATION_ID}: count mismatch for scope ${source.scope} ` +
            `(expected ${expectedIds.length}, found ${found})`
        )
      }
    }
  }

  if (!dryRun) {
    for (const index of CONFIG_AUDIT_INDEXES) {
      await target.createIndex(index.keys, { name: index.name })
    }
  }

  return report
}

/**
 * Rollback (dry-run mặc định), theo từng scope:
 * 1. audit trong `config_audits` có `_id` không nằm trong collection cũ (ghi sau khi chuyển code)
 *    được sao ngược về collection cũ, ánh xạ ngược bằng `fromConfigAuditDoc`
 *    (`key` -> templateKey/profileKey/scheduleId/targetId, `details` -> trường riêng);
 * 2. chỉ khi collection cũ đã chứa đủ các bản ghi vừa sao thì mới xóa toàn bộ
 *    scope đó khỏi `config_audits` (lệch thì báo lỗi, giữ nguyên scope);
 * 3. bỏ hai chỉ mục.
 * Không xóa/sửa bản ghi sẵn có của 4 collection cũ. `updated` = số bản ghi bị xóa
 * khỏi `config_audits` (hoặc sẽ bị xóa khi dry-run); `restored` = số bản ghi sao ngược.
 */
export async function rollbackMergeConfigAudits(
  database: ConfigAuditMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<ConfigAuditMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(CONFIG_AUDITS_COLLECTION)

  for (const source of CONFIG_AUDIT_SOURCES) {
    const legacyCollection = database.collection(source.collection)
    const legacyDocs = await legacyCollection.find().toArray()
    const legacyIds = new Set(legacyDocs.map(d => String(d._id)))
    report.counts[source.scope].source = legacyDocs.length

    const rows = await target.find({ scope: source.scope }).toArray()
    const rowIds = new Set(rows.map(r => String(r._id)))
    for (const legacy of legacyDocs) {
      report.scanned += 1
      if (!rowIds.has(String(legacy._id))) report.skipped += 1
    }

    const fresh = rows.filter(r => !legacyIds.has(String(r._id)))
    report.restored += fresh.length
    report.updated += rows.length
    if (dryRun) continue

    for (const row of fresh) {
      await legacyCollection.updateOne(
        { _id: row._id },
        { $setOnInsert: fromConfigAuditDoc(source, row) },
        { upsert: true }
      )
    }
    const have = await legacyCollection.countDocuments({
      _id: { $in: fresh.map(r => r._id) },
    })
    if (have !== fresh.length) {
      report.errors.push(
        `${source.collection}: ${have}/${fresh.length} audit rows restored; ` +
          `${CONFIG_AUDITS_COLLECTION} scope=${source.scope} kept`
      )
      report.updated -= rows.length
      report.restored -= fresh.length - have
      continue
    }
    await target.deleteMany({ scope: source.scope })
  }

  for (const source of CONFIG_AUDIT_SOURCES) {
    report.counts[source.scope].target = await target.countDocuments({
      scope: source.scope,
    })
  }

  if (!dryRun) {
    for (const index of CONFIG_AUDIT_INDEXES) {
      try {
        await target.dropIndex(index.name)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
  }

  return report
}
