import { safeDropIndex, safeIndexes } from './migration.mongo-helpers'
import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-GRT: gom `signing_grants` (SigningGrant) vào `smartca_signing_sessions`
 * (SmartCaSigningSession) với `kind`: phiên giao dịch là `kind='session'`, grant
 * là `kind='grant'`. Giữ `_id` cũ của từng grant (`Contract`/`ContractSignature`
 * không tham chiếu `_id` grant, nhưng `_id` được giữ để không đứt tham chiếu nếu có).
 *
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - Gán `kind='session'` cho mọi phiên chưa có `kind` (phiên tạo trước khi chuyển
 *   code). Code mới truy vấn luôn kèm `kind`, nên bước này bắt buộc.
 * - Idempotent theo `_id`: grant đã có ở đích cùng kind bị bỏ qua. `_id` đã dùng
 *   ở đích bởi bản ghi khác kind (hoặc trùng trong nguồn): Dòng xung đột (cùng `_id` khác kind ở đích hoặc trùng giữa hai nguồn) không được ghi, chỉ báo vào `errors` (không checkpoint); các dòng còn lại vẫn được sao.
 * - Kiểm đếm sau khi áp dụng: mọi `_id` grant nguồn phải có ở đích (`_id $in`),
 *   và không còn phiên thiếu `kind`; lệch thì ném lỗi.
 * - KHÔNG dedupe, KHÔNG xóa dữ liệu trùng. Dữ liệu thật có trùng (DB có thể chưa
 *   từng có unique), nên mọi dòng được sao đủ; chỉ mục unique chỉ tạo khi dữ liệu
 *   thỏa, nếu không thì tạo chỉ mục thường và ghi cảnh báo.
 * - Chỉ mục khi áp dụng:
 *   1. `(kind, contractId, signerId, artifactHash, status)` thường;
 *   2. `providerTransactionId`: trước khi sao grant, BỎ unique cũ không partial
 *      (grant không có trường này, nên unique cũ sẽ đụng nhau); sau đó tạo UNIQUE
 *      partial `{kind:'session'}` nếu mọi phiên có `providerTransactionId` và không
 *      trùng; không thì tạo chỉ mục thường `(kind, providerTransactionId)`;
 *   3. `tokenHash` của grant: UNIQUE partial `{kind:'grant'}` nếu thỏa, không thì
 *      chỉ mục thường `(kind, tokenHash)`.
 * - Không xóa/sửa collection `signing_grants` và không xóa dữ liệu nào.
 * - Rollback (dry-run mặc định), sao ngược kể cả dữ liệu ghi sau chuyển code:
 *   `_id` có ở cả hai bên được `replaceOne` bằng bản ở đích (bỏ `kind`, giữ
 *   `consumedAt` đã đổi); `_id` chỉ có ở đích được chèn ngược. Chỉ khi
 *   `signing_grants` chứa đủ mới xóa grant khỏi đích, rồi bỏ 5 chỉ mục mới, gỡ
 *   `kind` khỏi phiên, và khôi phục unique cũ trên `providerTransactionId` nếu dữ
 *   liệu còn thỏa.
 */
export const SIGNING_GRANTS_MERGE_MIGRATION_ID = '028-signing-grants-merge'

export const SIGNING_SESSIONS_COLLECTION = 'smartca_signing_sessions'

export const LEGACY_SIGNING_GRANTS_COLLECTION = 'signing_grants'

/** Khớp chỉ mục khai báo ở `smartca-signing-session.schema.ts`. */
export const SESSION_KIND_CONTRACT_INDEX =
  'smartca_signing_sessions_kind_contract_signer_artifact_status'
export const SESSION_PROVIDER_TX_UNIQUE_INDEX =
  'smartca_signing_sessions_provider_tx_unique'
export const SESSION_PROVIDER_TX_FALLBACK_INDEX =
  'smartca_signing_sessions_kind_provider_tx'
export const GRANT_TOKEN_HASH_UNIQUE_INDEX =
  'smartca_signing_grants_token_hash_unique'
export const GRANT_TOKEN_HASH_FALLBACK_INDEX =
  'smartca_signing_grants_kind_token_hash'

/** Unique cũ (không partial) trên `providerTransactionId` mà TypeORM đã tạo khi còn entity cũ. */
export const LEGACY_PROVIDER_TX_INDEX_KEY: Record<string, 1 | -1> = {
  providerTransactionId: 1,
}
const LEGACY_PROVIDER_TX_INDEX_NAME = 'providerTransactionId_1'

const SESSION_KIND_CONTRACT_KEYS: Record<string, 1 | -1> = {
  kind: 1,
  contractId: 1,
  signerId: 1,
  artifactHash: 1,
  status: 1,
}

const NEW_INDEX_NAMES: readonly string[] = [
  SESSION_KIND_CONTRACT_INDEX,
  SESSION_PROVIDER_TX_UNIQUE_INDEX,
  SESSION_PROVIDER_TX_FALLBACK_INDEX,
  GRANT_TOKEN_HASH_UNIQUE_INDEX,
  GRANT_TOKEN_HASH_FALLBACK_INDEX,
]

type Doc = Record<string, unknown> & { _id: unknown }

export type SigningIndexInfo = {
  name: string
  key: Record<string, 1 | -1>
  unique?: boolean | undefined
  partialFilterExpression?: Record<string, unknown> | undefined
}

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface SigningMongoCollection {
  find(filter?: Record<string, unknown>): { toArray(): Promise<Doc[]> }
  countDocuments(filter?: Record<string, unknown>): Promise<number>
  distinct(key: string, filter?: Record<string, unknown>): Promise<unknown[]>
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<unknown>
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<unknown>
  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>
  ): Promise<unknown>
  deleteMany(filter: Record<string, unknown>): Promise<unknown>
  indexes(): Promise<SigningIndexInfo[]>
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

export interface SigningMongoDatabase {
  collection(name: string): SigningMongoCollection
}

export type SigningGrantsMigrationReport = MigrationReport & {
  /** Số grant nguồn và số grant ở đích (`kind='grant'`) sau khi chạy. */
  grants: { source: number; target: number }
  /** Số phiên thiếu `kind` (dry-run: sẽ được gán; áp dụng: đã gán). */
  sessionsBackfilled: number
  /** Rollback: số grant được sao ngược về `signing_grants`. */
  restored: number
  /** Chỉ mục đã tạo/bỏ (`create:<tên>`, `drop:<tên>`); dry-run ghi việc sẽ làm. */
  indexes: string[]
  /** Cảnh báo không làm dừng: dữ liệu không thỏa unique nên dùng chỉ mục thường. */
  warnings: string[]
}

function newReport(dryRun: boolean): SigningGrantsMigrationReport {
  return {
    migrationId: SIGNING_GRANTS_MERGE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    grants: { source: 0, target: 0 },
    sessionsBackfilled: 0,
    restored: 0,
    indexes: [],
    warnings: [],
  }
}

/** Ánh xạ grant cũ sang bản ghi hợp nhất (không gồm `_id`). */
export function toGrantDoc(legacy: Doc): Record<string, unknown> {
  const { _id: _unused, ...rest } = legacy
  void _unused
  return { kind: 'grant', ...rest }
}

/** Ánh xạ ngược: bỏ `_id` và `kind`; mọi trường khác giữ nguyên. */
export function fromGrantDoc(row: Doc): Record<string, unknown> {
  const { _id: _unusedId, kind: _unusedKind, ...rest } = row
  void _unusedId
  void _unusedKind
  return rest
}

/** Có giá trị trùng trong nhóm (bỏ qua thiếu/null) hay không. */
async function hasDuplicates(
  collection: SigningMongoCollection,
  field: string,
  filter: Record<string, unknown>
): Promise<boolean> {
  const scope = { ...filter, [field]: { $ne: null } }
  const total = await collection.countDocuments(scope)
  const distinct = await collection.distinct(field, scope)
  return distinct.length !== total
}

function isLegacyProviderTxUnique(index: SigningIndexInfo): boolean {
  return (
    index.unique === true &&
    !index.partialFilterExpression &&
    JSON.stringify(index.key) === JSON.stringify(LEGACY_PROVIDER_TX_INDEX_KEY)
  )
}

/** Bỏ unique cũ trên `providerTransactionId` trước khi sao grant (grant không có trường đó). */
async function dropLegacyProviderTxUnique(
  target: SigningMongoCollection,
  report: SigningGrantsMigrationReport,
  dryRun: boolean
): Promise<void> {
  // Collection chưa tồn tại (chưa có phiên SmartCA): coi như không có chỉ mục cũ.
  for (const index of await safeIndexes(target)) {
    if (!isLegacyProviderTxUnique(index)) continue
    if (!dryRun) await safeDropIndex(target, index.name)
    report.indexes.push(`drop:${index.name}`)
  }
}

async function buildIndexes(
  target: SigningMongoCollection,
  report: SigningGrantsMigrationReport
): Promise<void> {
  await target.createIndex(SESSION_KIND_CONTRACT_KEYS, {
    name: SESSION_KIND_CONTRACT_INDEX,
  })
  report.indexes.push(`create:${SESSION_KIND_CONTRACT_INDEX}`)

  const sessionScope = { kind: 'session' }
  const sessionTxMissing = await target.countDocuments({
    ...sessionScope,
    providerTransactionId: null,
  })
  if (
    sessionTxMissing > 0 ||
    (await hasDuplicates(target, 'providerTransactionId', sessionScope))
  ) {
    await target.createIndex(
      { kind: 1, providerTransactionId: 1 },
      { name: SESSION_PROVIDER_TX_FALLBACK_INDEX }
    )
    report.indexes.push(`create:${SESSION_PROVIDER_TX_FALLBACK_INDEX}`)
    report.warnings.push(
      `providerTransactionId của phiên không thỏa unique ` +
        `(thiếu: ${sessionTxMissing}); dùng chỉ mục thường ${SESSION_PROVIDER_TX_FALLBACK_INDEX}`
    )
  } else {
    await target.createIndex(
      { providerTransactionId: 1 },
      {
        name: SESSION_PROVIDER_TX_UNIQUE_INDEX,
        unique: true,
        partialFilterExpression: sessionScope,
      }
    )
    report.indexes.push(`create:${SESSION_PROVIDER_TX_UNIQUE_INDEX}`)
  }

  const grantScope = { kind: 'grant' }
  const tokenMissing = await target.countDocuments({
    ...grantScope,
    tokenHash: null,
  })
  if (
    tokenMissing > 0 ||
    (await hasDuplicates(target, 'tokenHash', grantScope))
  ) {
    await target.createIndex(
      { kind: 1, tokenHash: 1 },
      { name: GRANT_TOKEN_HASH_FALLBACK_INDEX }
    )
    report.indexes.push(`create:${GRANT_TOKEN_HASH_FALLBACK_INDEX}`)
    report.warnings.push(
      `tokenHash của grant không thỏa unique (thiếu: ${tokenMissing}); ` +
        `dùng chỉ mục thường ${GRANT_TOKEN_HASH_FALLBACK_INDEX}`
    )
  } else {
    await target.createIndex(
      { tokenHash: 1 },
      {
        name: GRANT_TOKEN_HASH_UNIQUE_INDEX,
        unique: true,
        partialFilterExpression: grantScope,
      }
    )
    report.indexes.push(`create:${GRANT_TOKEN_HASH_UNIQUE_INDEX}`)
  }
}

/**
 * Sao `signing_grants` sang `smartca_signing_sessions` (kind='grant') theo `_id`,
 * gán `kind='session'` cho phiên cũ, rồi tạo chỉ mục. Không xóa/sửa collection cũ.
 * `dryRun` chỉ đọc và đếm.
 */
export async function migrateSigningGrants(
  database: SigningMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<SigningGrantsMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(SIGNING_SESSIONS_COLLECTION)
  const legacy = database.collection(LEGACY_SIGNING_GRANTS_COLLECTION)

  const legacyDocs = await legacy.find().toArray()
  report.grants.source = legacyDocs.length
  const plan: Doc[] = []
  const expectedIds: unknown[] = []

  for (const doc of legacyDocs) {
    report.scanned += 1
    const label = `${LEGACY_SIGNING_GRANTS_COLLECTION}:${String(doc._id)}`
    const existing = await target.find({ _id: doc._id }).toArray()
    const other = existing.find(d => d.kind !== 'grant')
    if (other) {
      report.errors.push(
        `${label} trùng _id với bản ghi đích kind=${String(other.kind)}`
      )
      continue
    }
    expectedIds.push(doc._id)
    if (existing.length > 0) {
      report.skipped += 1
      continue
    }
    plan.push(doc)
    report.updated += 1
  }

  const unkinded = await target.countDocuments({ kind: { $exists: false } })
  report.sessionsBackfilled = unkinded
  await dropLegacyProviderTxUnique(target, report, dryRun)

  if (!dryRun) {
    if (unkinded > 0) {
      await target.updateMany(
        { kind: { $exists: false } },
        { $set: { kind: 'session' } }
      )
    }
    for (const doc of plan) {
      await target.updateOne(
        { _id: doc._id },
        { $setOnInsert: toGrantDoc(doc) },
        { upsert: true }
      )
    }
  }

  report.grants.target = await target.countDocuments({ kind: 'grant' })

  if (!dryRun) {
    // Đích có thể nhiều hơn do ghi mới sau chuyển code, nên kiểm theo `_id` nguồn.
    const found = await target.countDocuments({
      kind: 'grant',
      _id: { $in: expectedIds },
    })
    if (found !== expectedIds.length) {
      throw new Error(
        `${SIGNING_GRANTS_MERGE_MIGRATION_ID}: count mismatch for grant ` +
          `(expected ${expectedIds.length}, found ${found})`
      )
    }
    const left = await target.countDocuments({ kind: { $exists: false } })
    if (left > 0) {
      throw new Error(
        `${SIGNING_GRANTS_MERGE_MIGRATION_ID}: ${left} session rows still without kind`
      )
    }
    await buildIndexes(target, report)
  }

  return report
}

/**
 * Rollback (dry-run mặc định), sao ngược theo `_id`:
 * 1. grant có ở cả hai bên: `replaceOne` bản cũ bằng bản ở đích (bỏ `kind`);
 * 2. grant chỉ có ở đích (tạo sau chuyển code): chèn vào `signing_grants`;
 * 3. chỉ khi `signing_grants` chứa đủ mới xóa `kind='grant'` khỏi đích (lệch thì
 *    báo lỗi, giữ nguyên, và dừng các bước sau);
 * 4. bỏ 5 chỉ mục mới; gỡ `kind` khỏi phiên; khôi phục unique cũ trên
 *    `providerTransactionId` nếu dữ liệu còn thỏa (không thì cảnh báo).
 */
export async function rollbackSigningGrants(
  database: SigningMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<SigningGrantsMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(SIGNING_SESSIONS_COLLECTION)
  const legacy = database.collection(LEGACY_SIGNING_GRANTS_COLLECTION)

  const legacyDocs = await legacy.find().toArray()
  const legacyIds = new Set(legacyDocs.map(d => String(d._id)))
  report.grants.source = legacyDocs.length

  const rows = await target.find({ kind: 'grant' }).toArray()
  report.grants.target = rows.length
  const rowIds = new Set(rows.map(r => String(r._id)))
  for (const doc of legacyDocs) {
    report.scanned += 1
    if (!rowIds.has(String(doc._id))) report.skipped += 1
  }
  report.restored = rows.length
  report.updated = rows.length

  if (!dryRun) {
    for (const row of rows) {
      const doc = fromGrantDoc(row)
      if (legacyIds.has(String(row._id))) {
        await legacy.replaceOne({ _id: row._id }, doc)
      } else {
        await legacy.updateOne(
          { _id: row._id },
          { $setOnInsert: doc },
          { upsert: true }
        )
      }
    }
    const have = await legacy.countDocuments({
      _id: { $in: rows.map(r => r._id) },
    })
    if (have !== rows.length) {
      report.errors.push(
        `${LEGACY_SIGNING_GRANTS_COLLECTION}: ${have}/${rows.length} rows restored; ` +
          `${SIGNING_SESSIONS_COLLECTION} kind=grant kept`
      )
      report.updated = 0
      report.restored = have
    } else {
      await target.deleteMany({ kind: 'grant' })
    }
  }

  if (!dryRun && report.errors.length === 0) {
    for (const name of NEW_INDEX_NAMES) {
      try {
        await target.dropIndex(name)
        report.indexes.push(`drop:${name}`)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
    await target.updateMany({ kind: 'session' }, { $unset: { kind: '' } })

    const txMissing = await target.countDocuments({
      providerTransactionId: null,
    })
    const txDuplicate = await hasDuplicates(target, 'providerTransactionId', {})
    if (txMissing > 0 || txDuplicate) {
      report.warnings.push(
        `không khôi phục unique ${LEGACY_PROVIDER_TX_INDEX_NAME}: dữ liệu không thỏa`
      )
    } else if (!(await safeIndexes(target)).some(isLegacyProviderTxUnique)) {
      await target.createIndex(LEGACY_PROVIDER_TX_INDEX_KEY, {
        name: LEGACY_PROVIDER_TX_INDEX_NAME,
        unique: true,
      })
      report.indexes.push(`create:${LEGACY_PROVIDER_TX_INDEX_NAME}`)
    }
  }

  return report
}
