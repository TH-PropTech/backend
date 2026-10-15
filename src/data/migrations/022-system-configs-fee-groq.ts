import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-CFG2: hợp nhất `platform_fee_schedules` (scope `platform-fee`) và `groq_api_keys`
 * (scope `groq-key`) vào `system_configs` (đã có scope `job`/`recommendation` từ 013).
 *
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - Giữ `_id` cũ; idempotent (bản ghi đã có theo `_id` bị bỏ qua).
 * - Khóa đích: fee = `scheduleId@version`, groq = `keyHash`. Nguồn trùng khóa: chỉ sao bản
 *   đầu, các bản còn lại liệt kê ở `duplicateIds`.
 * - Bản ghi đích đã có cùng `(scope, key)` nhưng khác `_id` được báo lỗi, không ghi đè.
 * - `groq_api_keys.createdAt` (epoch ms) được đổi thành Date ở đích (FIFO claim vẫn theo thời
 *   gian); rollback đổi ngược về số. `keyEnc/keyHash` giữ nguyên dạng mã hóa.
 * - Kiểm đếm sau khi áp dụng theo `_id $in` đúng scope; lệch thì ném lỗi và dừng.
 *   Sau đó tạo các chỉ mục: `(scope,key)` unique (như 013), partial unique
 *   `(scheduleId,version)` cho `platform-fee`, partial unique `keyHash` cho `groq-key`,
 *   và chỉ mục truy vấn `(scope,status,effectiveFrom)`, `(scope,status,cooldownUntil,createdAt)`.
 * - Không xóa collection cũ.
 * - Rollback sao ngược kể cả bản ghi tạo/đổi sau khi chuyển code về collection cũ
 *   (khớp theo `_id` rồi theo khóa), chỉ xóa scope khỏi `system_configs` khi đã sao đủ,
 *   rồi bỏ các chỉ mục của migration này (giữ chỉ mục `(scope,key)` của 013).
 */
export const FEE_GROQ_MIGRATION_ID = '022-system-configs-fee-groq'

export const SYSTEM_CONFIGS_COLLECTION = 'system_configs'

/** Chỉ mục `(scope,key)` unique do 013 tạo; 022 đảm bảo tồn tại (cùng tên, idempotent). */
const SCOPE_KEY_INDEX = {
  name: 'system_configs_scope_key_unique',
  keys: { scope: 1, key: 1 } as Record<string, 1 | -1>,
  unique: true,
}

export type FeeGroqScopeName = 'platform-fee' | 'groq-key'

export interface FeeGroqIndex {
  name: string
  keys: Record<string, 1 | -1>
  unique?: boolean
  partialFilterExpression?: Record<string, unknown>
}

/** Chỉ mục do 022 tạo khi áp dụng và bỏ khi rollback. */
export const FEE_GROQ_INDEXES: readonly FeeGroqIndex[] = [
  {
    name: 'system_configs_fee_schedule_unique',
    keys: { scheduleId: 1, version: 1 },
    unique: true,
    partialFilterExpression: { scope: 'platform-fee' },
  },
  {
    name: 'system_configs_fee_status_effective',
    keys: { scope: 1, status: 1, effectiveFrom: 1 },
  },
  {
    name: 'system_configs_groq_keyhash_unique',
    keys: { keyHash: 1 },
    unique: true,
    partialFilterExpression: { scope: 'groq-key' },
  },
  {
    name: 'system_configs_groq_claim',
    keys: { scope: 1, status: 1, cooldownUntil: 1, createdAt: 1 },
  },
]

type Doc = Record<string, unknown> & { _id: unknown }

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface FeeGroqMongoCollection {
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
    options?: {
      name?: string
      unique?: boolean
      partialFilterExpression?: Record<string, unknown>
    }
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export interface FeeGroqMongoDatabase {
  collection(name: string): FeeGroqMongoCollection
}

export type FeeGroqMigrationReport = MigrationReport & {
  counts: Record<FeeGroqScopeName, { source: number; target: number }>
  /** Bản ghi nguồn trùng khóa (chỉ bản đầu được sao). */
  duplicateIds: string[]
  /** Rollback: số bản ghi sao ngược/cập nhật về collection cũ. */
  restored: number
}

interface SourceDef {
  scope: FeeGroqScopeName
  collection: string
  /** Khóa đích của bản ghi cũ; null nếu thiếu. */
  keyOf(legacy: Doc): string | null
  /** Bản ghi cũ -> `system_configs` (không gồm `_id`). */
  toRow(legacy: Doc, key: string): Record<string, unknown>
  /** `system_configs` -> hình collection cũ (không gồm `_id`). */
  toLegacy(row: Doc): Record<string, unknown>
}

const FEE_FIELDS = [
  'scheduleId',
  'version',
  'status',
  'effectiveFrom',
  'rules',
  'legalReviewStatus',
  'reviewReference',
  'contentHash',
  'draftRevision',
  'createdBy',
  'publishedBy',
  'publishedAt',
  'createdAt',
  'updatedAt',
] as const

const GROQ_FIELDS = [
  'keyEnc',
  'keyHash',
  'keyMask',
  'status',
  'cooldownUntil',
  'usageCount',
  'failCount',
  'lastUsedAt',
  'lastError',
  'check',
] as const

function pick(source: Doc, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field]
  }
  return out
}

const FEE_SOURCE: SourceDef = {
  scope: 'platform-fee',
  collection: 'platform_fee_schedules',
  keyOf: legacy =>
    typeof legacy.scheduleId === 'string' && typeof legacy.version === 'number'
      ? `${legacy.scheduleId}@${legacy.version}`
      : null,
  toRow: (legacy, key) => ({
    scope: 'platform-fee',
    key,
    ...pick(legacy, FEE_FIELDS),
  }),
  toLegacy: row => pick(row, FEE_FIELDS),
}

const GROQ_SOURCE: SourceDef = {
  scope: 'groq-key',
  collection: 'groq_api_keys',
  keyOf: legacy =>
    typeof legacy.keyHash === 'string' && legacy.keyHash.length > 0
      ? legacy.keyHash
      : null,
  toRow: (legacy, key) => {
    const row: Record<string, unknown> = {
      scope: 'groq-key',
      key,
      ...pick(legacy, GROQ_FIELDS),
    }
    if (legacy.createdAt !== undefined) {
      row.createdAt = new Date(legacy.createdAt as number)
    }
    return row
  },
  toLegacy: row => {
    const legacy = pick(row, GROQ_FIELDS)
    if (row.createdAt !== undefined) {
      legacy.createdAt = (row.createdAt as Date).getTime()
    }
    return legacy
  },
}

export const FEE_GROQ_SOURCES: readonly SourceDef[] = [FEE_SOURCE, GROQ_SOURCE]

function newReport(dryRun: boolean): FeeGroqMigrationReport {
  return {
    migrationId: FEE_GROQ_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    duplicateIds: [],
    restored: 0,
    counts: {
      'platform-fee': { source: 0, target: 0 },
      'groq-key': { source: 0, target: 0 },
    },
  }
}

export async function migrateSystemConfigsFeeGroq(
  database: FeeGroqMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<FeeGroqMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(SYSTEM_CONFIGS_COLLECTION)
  const expectedByScope = new Map<FeeGroqScopeName, unknown[]>()

  for (const source of FEE_GROQ_SOURCES) {
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
      const key = source.keyOf(legacy)
      if (key === null) {
        report.errors.push(
          `${source.collection}:${String(legacy._id)} thiếu khóa`
        )
        continue
      }
      if (seenKeys.has(key)) {
        // Không sao bản trùng khóa (tránh vi phạm unique ở đích) và KHÔNG âm thầm bỏ:
        // báo vào errors để không checkpoint, người vận hành quyết định xử lý dữ liệu nguồn.
        const label = `${source.collection}:${String(legacy._id)}`
        report.duplicateIds.push(label)
        report.errors.push(
          `${label} trùng khóa (${key}) với bản ghi nguồn đứng trước; không sao`
        )
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
          { $setOnInsert: source.toRow(legacy, key) },
          { upsert: true }
        )
      }
    }
  }

  for (const source of FEE_GROQ_SOURCES) {
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
          `${FEE_GROQ_MIGRATION_ID}: count mismatch for scope ${source.scope} ` +
            `(expected ${expectedIds.length}, found ${found})`
        )
      }
    }
  }

  if (!dryRun) {
    await target.createIndex(SCOPE_KEY_INDEX.keys, {
      name: SCOPE_KEY_INDEX.name,
      unique: true,
    })
    for (const index of FEE_GROQ_INDEXES) {
      await target.createIndex(index.keys, {
        name: index.name,
        ...(index.unique !== undefined ? { unique: index.unique } : {}),
        ...(index.partialFilterExpression !== undefined
          ? { partialFilterExpression: index.partialFilterExpression }
          : {}),
      })
    }
  }

  return report
}

/**
 * Rollback (dry-run mặc định), theo từng scope: mỗi bản ghi `system_configs` được
 * ghi lại vào collection cũ (khớp `_id`, rồi khớp khóa; không có thì chèn với `_id` đó).
 * Trường `createdAt` của bản ghi cũ giữ nguyên khi khớp. Chỉ khi collection cũ
 * đã chứa đủ khóa thì mới xóa scope khỏi `system_configs`; lệch thì báo lỗi và giữ scope.
 * Cuối cùng bỏ các chỉ mục của 022 (nếu không có lỗi), giữ chỉ mục `(scope,key)` của 013.
 * `updated` = số bản ghi bị xóa khỏi `system_configs` (hoặc sẽ bị xóa khi dry-run);
 * `restored` = số bản ghi sao ngược.
 */
export async function rollbackSystemConfigsFeeGroq(
  database: FeeGroqMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<FeeGroqMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(SYSTEM_CONFIGS_COLLECTION)

  for (const source of FEE_GROQ_SOURCES) {
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
      const key = source.keyOf(d)
      if (key !== null && !legacyByKey.has(key)) legacyByKey.set(key, d)
    }

    for (const row of rows) {
      const key = String(row.key)
      const body = source.toLegacy(row)
      const match = legacyById.get(String(row._id)) ?? legacyByKey.get(key)
      if (match) {
        const { createdAt: _created, ...state } = body
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
      after.map(d => source.keyOf(d)).filter((k): k is string => k !== null)
    )
    const lacking = rows.filter(r => !afterKeys.has(String(r.key)))
    if (lacking.length > 0) {
      report.errors.push(
        `${source.collection}: ${lacking.length}/${rows.length} rows not restored; ` +
          `${SYSTEM_CONFIGS_COLLECTION} scope=${source.scope} kept`
      )
      report.updated -= rows.length
      report.restored -= lacking.length
      continue
    }
    await target.deleteMany({ scope: source.scope })
  }

  for (const source of FEE_GROQ_SOURCES) {
    report.counts[source.scope].target = await target.countDocuments({
      scope: source.scope,
    })
  }

  if (!dryRun && report.errors.length === 0) {
    for (const index of FEE_GROQ_INDEXES) {
      try {
        await target.dropIndex(index.name)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
  }

  return report
}
