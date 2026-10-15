import { safeDropIndex, safeIndexes } from './migration.mongo-helpers'
import type { MigrationOptions, MigrationReport } from './migration.types'

export const CONTRACT_LAYOUT_PROFILES_MERGE_MIGRATION_ID =
  '025-contract-layout-profiles-merge'

export const CONTRACT_LAYOUT_SOURCE_COLLECTION = 'contract_layout_profiles'
export const CONTRACT_TEMPLATES_COLLECTION = 'contract_templates'

const TEMPLATE_KIND = 'template'
const LAYOUT_KIND = 'layout'

/** Trường chỉ có ở mẫu hợp đồng: rollback bỏ khỏi bản ghi layout ghi ngược. */
const TEMPLATE_ONLY_FIELDS = [
  'clauses',
  'schemaVersion',
  'effectiveFrom',
  'referenceOnly',
  'reviewStatus',
  'reviewReference',
  'annexDefinitions',
  'allowedVariables',
  'addenda',
  'citationIds',
] as const

type Doc = Record<string, unknown> & { _id: unknown }

export type ContractLayoutIndexInfo = {
  name: string
  key: Record<string, 1 | -1>
  unique?: boolean
  partialFilterExpression?: Record<string, unknown>
}

export type ContractLayoutIndexSpec = {
  name: string
  keys: Record<string, 1 | -1>
  options: {
    unique?: boolean
    partialFilterExpression?: Record<string, unknown>
  }
}

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface ContractLayoutMongoCollection {
  find(filter?: Record<string, unknown>): { toArray(): Promise<Doc[]> }
  countDocuments(filter?: Record<string, unknown>): Promise<number>
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<{ upsertedCount?: number }>
  updateMany(
    filter: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>
      $unset?: Record<string, unknown>
    }
  ): Promise<unknown>
  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>
  ): Promise<{ matchedCount?: number }>
  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount?: number }>
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: {
      name?: string
      unique?: boolean
      partialFilterExpression?: Record<string, unknown>
    }
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
  indexes(): Promise<ContractLayoutIndexInfo[]>
}

export interface ContractLayoutMongoDatabase {
  collection(name: string): ContractLayoutMongoCollection
}

export type ContractLayoutKindCount = { source: number; target: number }

export type ContractLayoutMigrationReport = MigrationReport & {
  counts: {
    layout: ContractLayoutKindCount
    template: ContractLayoutKindCount
  }
  /** Rollback: số bản ghi layout được sao ngược (mới hoặc đã đổi sau khi chuyển code) về collection cũ. */
  restored: number
}

/** Unique theo kind: chỉ là partial index nên migration tạo, TypeORM Mongo không tạo được. */
export const CONTRACT_TEMPLATE_TEMPLATE_UNIQUE_INDEX: ContractLayoutIndexSpec =
  {
    name: 'contract_templates_template_key_version_unique',
    keys: { templateKey: 1, version: 1 },
    options: {
      unique: true,
      partialFilterExpression: { kind: TEMPLATE_KIND },
    },
  }

export const CONTRACT_TEMPLATE_LAYOUT_UNIQUE_INDEX: ContractLayoutIndexSpec = {
  name: 'contract_templates_layout_profile_version_unique',
  keys: { profileKey: 1, version: 1 },
  options: {
    unique: true,
    partialFilterExpression: { kind: LAYOUT_KIND },
  },
}

/** Mọi chỉ mục migration tạo/gỡ khi áp dụng và rollback. */
export const CONTRACT_LAYOUT_MERGE_INDEXES: readonly ContractLayoutIndexSpec[] =
  [
    CONTRACT_TEMPLATE_TEMPLATE_UNIQUE_INDEX,
    CONTRACT_TEMPLATE_LAYOUT_UNIQUE_INDEX,
    {
      name: 'contract_templates_kind_profile_status',
      keys: { kind: 1, profileKey: 1, status: 1 },
      options: {},
    },
    {
      name: 'contract_templates_kind_legal_status_template',
      keys: { kind: 1, legalProfile: 1, status: 1, templateKey: 1 },
      options: {},
    },
  ]

/** Unique (templateKey, version) cũ của `contract_templates` (không partial) phải gỡ trước khi gom. */
const LEGACY_TEMPLATE_UNIQUE_KEY: Record<string, 1 | -1> = {
  templateKey: 1,
  version: 1,
}
/** Tên khi rollback tạo lại unique cũ (hình trước gom). */
const ROLLBACK_TEMPLATE_UNIQUE_NAME = 'templateKey_1_version_1'

function newReport(dryRun: boolean): ContractLayoutMigrationReport {
  return {
    migrationId: CONTRACT_LAYOUT_PROFILES_MERGE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    restored: 0,
    counts: {
      layout: { source: 0, target: 0 },
      template: { source: 0, target: 0 },
    },
  }
}

/** Ánh xạ bản ghi cũ sang dòng layout (không gồm `_id`, gắn `kind`); mọi trường khác giữ nguyên. */
export function toLayoutRowDoc(legacy: Doc): Record<string, unknown> {
  const { _id: _unused, ...rest } = legacy
  void _unused
  return { kind: LAYOUT_KIND, ...rest }
}

/** Ánh xạ ngược: bỏ `kind` và trường riêng của mẫu (không gồm `_id`); mọi trường khác giữ nguyên. */
export function fromLayoutRowDoc(row: Doc): Record<string, unknown> {
  const { _id: _unused, kind: _kind, ...rest } = row
  void _unused
  void _kind
  for (const field of TEMPLATE_ONLY_FIELDS) delete rest[field]
  return rest
}

function isLegacyTemplateUniqueIndex(index: ContractLayoutIndexInfo): boolean {
  if (index.unique !== true || index.partialFilterExpression !== undefined) {
    return false
  }
  const keys = Object.keys(index.key)
  const expected = Object.keys(LEGACY_TEMPLATE_UNIQUE_KEY)
  return (
    keys.length === expected.length &&
    expected.every(k => index.key[k] === LEGACY_TEMPLATE_UNIQUE_KEY[k])
  )
}

/**
 * Gom `contract_layout_profiles` vào `contract_templates` (kind='layout'), giữ
 * `_id` cũ, idempotent. Không xóa/sửa collection cũ. Thứ tự khi áp dụng:
 * 1. backfill `kind='template'` cho mẫu thiếu trường;
 * 2. gỡ unique cũ `(templateKey, version)` (nếu không, hai layout cùng version và
 *    templateKey null sẽ đụng nhau);
 * 3. tạo unique partial theo kind và các chỉ mục thường;
 * 4. sao layout, rồi kiểm đếm theo `_id $in`.
 * `dryRun` chỉ đọc và đếm. `_id` trùng với bản ghi đích không phải layout: Dòng xung đột (cùng `_id` khác kind ở đích hoặc trùng giữa hai nguồn) không được ghi, chỉ báo vào `errors` (không checkpoint); các dòng còn lại vẫn được sao.
 */
export async function migrateContractLayoutProfiles(
  database: ContractLayoutMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<ContractLayoutMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(CONTRACT_TEMPLATES_COLLECTION)
  const legacyDocs = await database
    .collection(CONTRACT_LAYOUT_SOURCE_COLLECTION)
    .find()
    .toArray()
  report.counts.layout.source = legacyDocs.length
  report.counts.template.source = await target.countDocuments({
    kind: { $ne: LAYOUT_KIND },
  })

  const plan: Array<{ legacy: Doc; exists: boolean }> = []
  const expectedIds: unknown[] = []
  for (const legacy of legacyDocs) {
    report.scanned += 1
    const label = `${CONTRACT_LAYOUT_SOURCE_COLLECTION}:${String(legacy._id)}`
    const [existing] = await target.find({ _id: legacy._id }).toArray()
    if (existing && existing.kind !== LAYOUT_KIND) {
      const otherKind =
        typeof existing.kind === 'string' ? existing.kind : TEMPLATE_KIND
      report.errors.push(
        `${label} trùng _id với bản ghi đích kind=${otherKind}`
      )
      continue
    }
    expectedIds.push(legacy._id)
    plan.push({ legacy, exists: Boolean(existing) })
  }

  if (!dryRun) {
    await target.updateMany(
      { kind: { $exists: false } },
      { $set: { kind: TEMPLATE_KIND } }
    )
    // Collection chưa tồn tại (chưa có bản ghi nào): không có chỉ mục cũ để gỡ.
    for (const index of await safeIndexes(target)) {
      if (isLegacyTemplateUniqueIndex(index)) {
        await safeDropIndex(target, index.name)
      }
    }
    for (const index of CONTRACT_LAYOUT_MERGE_INDEXES) {
      await target.createIndex(index.keys, {
        name: index.name,
        ...index.options,
      })
    }
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
        { $setOnInsert: toLayoutRowDoc(item.legacy) },
        { upsert: true }
      )
    }
  }

  report.counts.template.target = await target.countDocuments({
    kind: TEMPLATE_KIND,
  })
  report.counts.layout.target = await target.countDocuments({
    kind: LAYOUT_KIND,
  })
  if (!dryRun) {
    // Đích có thể nhiều hơn do ghi mới sau khi chuyển code, nên kiểm theo `_id` nguồn.
    const found = await target.countDocuments({
      kind: LAYOUT_KIND,
      _id: { $in: expectedIds },
    })
    if (found !== expectedIds.length) {
      throw new Error(
        `${CONTRACT_LAYOUT_PROFILES_MERGE_MIGRATION_ID}: count mismatch for layouts ` +
          `(expected ${expectedIds.length}, found ${found})`
      )
    }
    const untagged = await target.countDocuments({
      kind: { $exists: false },
    })
    if (untagged !== 0) {
      throw new Error(
        `${CONTRACT_LAYOUT_PROFILES_MERGE_MIGRATION_ID}: ${untagged} templates still without kind`
      )
    }
  }

  return report
}

/**
 * Rollback (dry-run mặc định):
 * 1. layout có `_id` ở cả hai bên: `replaceOne` bản cũ bằng bản ở đích (bỏ `kind`
 *    và trường riêng của mẫu), để phiên bản/trạng thái đổi sau khi chuyển code không mất;
 * 2. layout chỉ có ở đích (tạo sau khi chuyển code): chèn vào collection cũ;
 * 3. chỉ khi collection cũ chứa đủ các `_id` layout mới xóa layout khỏi đích
 *    (lệch thì báo lỗi, giữ nguyên);
 * 4. bỏ `kind` khỏi mẫu, gỡ chỉ mục mới, tạo lại unique `(templateKey, version)` cũ.
 * `updated` = số layout bị xóa khỏi đích (hoặc sẽ bị xóa khi dry-run); `restored` = số ghi ngược.
 */
export async function rollbackContractLayoutProfiles(
  database: ContractLayoutMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<ContractLayoutMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(CONTRACT_TEMPLATES_COLLECTION)
  const legacyCollection = database.collection(
    CONTRACT_LAYOUT_SOURCE_COLLECTION
  )

  const legacyDocs = await legacyCollection.find().toArray()
  const legacyIds = new Set(legacyDocs.map(d => String(d._id)))
  report.counts.layout.source = legacyDocs.length

  const rows = await target.find({ kind: LAYOUT_KIND }).toArray()
  const rowIds = new Set(rows.map(r => String(r._id)))
  for (const legacy of legacyDocs) {
    report.scanned += 1
    if (!rowIds.has(String(legacy._id))) report.skipped += 1
  }

  report.restored += rows.length
  report.updated += rows.length
  if (dryRun) {
    report.counts.layout.target = rows.length
    return report
  }

  for (const row of rows) {
    const legacyDoc = fromLayoutRowDoc(row)
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
      `${CONTRACT_LAYOUT_SOURCE_COLLECTION}: ${have}/${rows.length} rows restored; ` +
        `${CONTRACT_TEMPLATES_COLLECTION} kind=${LAYOUT_KIND} kept`
    )
    report.updated -= rows.length
    report.restored -= rows.length - have
    report.counts.layout.target = rows.length
    return report
  }

  await target.deleteMany({ kind: LAYOUT_KIND })
  await target.updateMany({ kind: TEMPLATE_KIND }, { $unset: { kind: '' } })
  for (const index of CONTRACT_LAYOUT_MERGE_INDEXES) {
    try {
      await target.dropIndex(index.name)
    } catch {
      // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
    }
  }
  await target.createIndex(LEGACY_TEMPLATE_UNIQUE_KEY, {
    name: ROLLBACK_TEMPLATE_UNIQUE_NAME,
    unique: true,
  })

  report.counts.layout.target = await target.countDocuments({
    kind: LAYOUT_KIND,
  })
  report.counts.template.target = await target.countDocuments({
    kind: { $ne: LAYOUT_KIND },
  })
  return report
}
