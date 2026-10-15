import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-OTP: sao `email_otps` (kind 'email') và `transaction_otps` (kind
 * 'transaction') sang collection hợp nhất `otps`, GIỮ `_id` cũ của từng bản ghi
 * (`Contract.otpSessionId`, `SigningGrant.otpSessionId` lưu id phiên giao dịch).
 *
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - Idempotent theo `_id`: bản ghi đã có ở đích cùng kind bị bỏ qua.
 *   Dòng xung đột (cùng `_id` khác kind ở đích hoặc trùng giữa hai nguồn) không được ghi, chỉ báo vào `errors` (không checkpoint); các dòng còn lại vẫn được sao.
 * - Kiểm đếm sau khi áp dụng: mọi `_id` nguồn phải có ở đích đúng kind
 *   (`_id $in`), lệch thì ném lỗi. Đích có thể nhiều hơn do ghi mới sau chuyển code.
 * - Chỉ mục khi áp dụng: `(kind, email, otpCode, action, isUsed)`. Không có
 *   unique và không có TTL ở hai collection cũ nên không cần tái tạo ràng buộc nào.
 * - Không xóa/sửa collection cũ; index cũ của `email_otps` (nếu có) còn nguyên.
 * - Rollback (dry-run mặc định), theo từng kind: `_id` có ở cả hai bên được
 *   `replaceOne` bản cũ bằng bản ở đích (giữ trạng thái mới, như `isUsed`,
 *   `status`); `_id` chỉ có ở đích (ghi sau chuyển code) được chèn ngược. Chỉ khi
 *   collection cũ chứa đủ `_id` của kind đó mới xóa kind đó khỏi `otps`, rồi bỏ chỉ mục.
 */
export const OTPS_MERGE_MIGRATION_ID = '021-otps-merge'

export const OTPS_COLLECTION = 'otps'

export type OtpKindName = 'email' | 'transaction'

type Doc = Record<string, unknown> & { _id: unknown }

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface OtpMongoCollection {
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

export interface OtpMongoDatabase {
  collection(name: string): OtpMongoCollection
}

export type OtpKindCount = { source: number; target: number }

export type OtpMigrationReport = MigrationReport & {
  counts: Record<OtpKindName, OtpKindCount>
  /** Rollback: số bản ghi được sao ngược (mới hoặc đã đổi sau khi chuyển code) về collection cũ. */
  restored: number
}

export type OtpSource = {
  kind: OtpKindName
  collection: string
}

export const OTP_SOURCES: readonly OtpSource[] = [
  { kind: 'email', collection: 'email_otps' },
  { kind: 'transaction', collection: 'transaction_otps' },
]

/** Khớp `Otp` (schemas/otp.schema.ts). */
export const OTP_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
}> = [
  {
    name: 'otps_kind_email_otp_code_action_used',
    keys: { kind: 1, email: 1, otpCode: 1, action: 1, isUsed: 1 },
  },
]

/** Trường chỉ thuộc loại email / chỉ thuộc loại giao dịch (để dọn khi rollback). */
const EMAIL_ONLY_FIELDS = ['email', 'isUsed']
const TRANSACTION_ONLY_FIELDS = [
  'userId',
  'deviceId',
  'challenge',
  'status',
  'attempts',
  'maxAttempts',
  'contractId',
  'signerRole',
  'contentLockedHash',
  'contextHash',
  'consumedAt',
]

/** Ánh xạ bản ghi cũ sang Otp (không gồm `_id`); mọi trường khác giữ nguyên. */
export function toOtpDoc(
  source: OtpSource,
  legacy: Doc
): Record<string, unknown> {
  const { _id: _unused, ...rest } = legacy
  void _unused
  return { kind: source.kind, ...rest }
}

/**
 * Ánh xạ ngược: bỏ `kind` (không gồm `_id`); bỏ trường của loại kia khi rỗng
 * (ghi sau chuyển code có thể để `null` cho trường không thuộc loại đó).
 */
export function fromOtpDoc(
  row: Doc,
  kind: OtpKindName
): Record<string, unknown> {
  const { _id: _unused, kind: _kind, ...rest } = row
  void _unused
  void _kind
  const otherOnly =
    kind === 'email' ? TRANSACTION_ONLY_FIELDS : EMAIL_ONLY_FIELDS
  for (const field of otherOnly) {
    if (rest[field] === null || rest[field] === undefined) delete rest[field]
  }
  return rest
}

function newReport(dryRun: boolean): OtpMigrationReport {
  return {
    migrationId: OTPS_MERGE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    restored: 0,
    counts: {
      email: { source: 0, target: 0 },
      transaction: { source: 0, target: 0 },
    },
  }
}

/**
 * Sao `email_otps` và `transaction_otps` sang `otps` theo `_id` (giữ `_id` cũ,
 * idempotent), rồi tạo chỉ mục. Không xóa/sửa collection cũ.
 * `dryRun` chỉ đọc và đếm. Khi áp dụng: `_id` trùng giữa hai nguồn, hoặc `_id`
 * đã tồn tại ở đích với `kind` khác đều làm dừng TRƯỚC khi ghi; sau khi ghi,
 * mọi `_id` nguồn phải có mặt ở đích đúng `kind`, lệch thì ném lỗi.
 */
export async function migrateOtps(
  database: OtpMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<OtpMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(OTPS_COLLECTION)
  const plan: Array<{ source: OtpSource; legacy: Doc; exists: boolean }> = []
  const expectedByKind: Record<OtpKindName, unknown[]> = {
    email: [],
    transaction: [],
  }
  const seenIds = new Map<string, OtpKindName>()

  for (const source of OTP_SOURCES) {
    const legacyDocs = await database
      .collection(source.collection)
      .find()
      .toArray()
    report.counts[source.kind].source = legacyDocs.length
    for (const legacy of legacyDocs) {
      report.scanned += 1
      const label = `${source.collection}:${String(legacy._id)}`
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

  for (const item of plan) {
    if (item.exists) {
      report.skipped += 1
      continue
    }
    report.updated += 1
    if (!dryRun) {
      await target.updateOne(
        { _id: item.legacy._id },
        { $setOnInsert: toOtpDoc(item.source, item.legacy) },
        { upsert: true }
      )
    }
  }

  for (const source of OTP_SOURCES) {
    const count = report.counts[source.kind]
    count.target = await target.countDocuments({ kind: source.kind })
    if (!dryRun) {
      const expectedIds = expectedByKind[source.kind]
      const found = await target.countDocuments({
        kind: source.kind,
        _id: { $in: expectedIds },
      })
      if (found !== expectedIds.length) {
        throw new Error(
          `${OTPS_MERGE_MIGRATION_ID}: count mismatch for kind ${source.kind} ` +
            `(expected ${expectedIds.length}, found ${found})`
        )
      }
    }
  }

  if (!dryRun) {
    for (const index of OTP_INDEXES) {
      await target.createIndex(index.keys, { name: index.name })
    }
  }

  return report
}

/**
 * Rollback (dry-run mặc định), theo từng kind:
 * 1. `_id` có ở cả hai bên: `replaceOne` bản cũ bằng bản ở đích (bỏ `kind`);
 * 2. `_id` chỉ có ở đích (tạo sau khi chuyển code): chèn vào collection cũ;
 * 3. chỉ khi collection cũ chứa đủ các `_id` của kind đó mới xóa kind đó khỏi
 *    `otps` (lệch thì báo lỗi, giữ nguyên kind);
 * 4. bỏ chỉ mục (chỉ khi không có lỗi).
 * `updated` = số bản ghi bị xóa khỏi đích (hoặc sẽ bị xóa khi dry-run);
 * `restored` = số bản ghi ghi ngược về collection cũ.
 */
export async function rollbackOtps(
  database: OtpMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<OtpMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(OTPS_COLLECTION)

  for (const source of OTP_SOURCES) {
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
      const legacyDoc = fromOtpDoc(row, source.kind)
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
          `${OTPS_COLLECTION} kind=${source.kind} kept`
      )
      report.updated -= rows.length
      report.restored -= rows.length - have
      continue
    }
    await target.deleteMany({ kind: source.kind })
  }

  for (const source of OTP_SOURCES) {
    report.counts[source.kind].target = await target.countDocuments({
      kind: source.kind,
    })
  }

  if (!dryRun && report.errors.length === 0) {
    for (const index of OTP_INDEXES) {
      try {
        await target.dropIndex(index.name)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
  }

  return report
}
