/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- tài liệu Mongo thô (bản ghi không kiểu hóa), giống 019/020 */
import { ObjectId } from 'mongodb'
import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-KYC: nhúng collection `kyc_records` vào `users.kyc` (`KycInfo`).
 *
 * - `recordId` của hồ sơ nhúng là `_id` cũ của `kyc_records`: id công khai của
 *   `GET/PATCH /kyc/:id` và `/kyc/:id/media/:field` vẫn tra được qua `kyc.recordId`.
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - KHÔNG giả định unique ở nguồn: nhiều hồ sơ cùng user không làm migration dừng.
 *   Nhúng bản MỚI NHẤT (createdAt, rồi _id) của mỗi user; các bản cũ hơn được GIỮ
 *   NGUYÊN trong `kyc_records` và báo cáo ở `superseded` (không xóa, không dedup).
 * - Không mất dữ liệu: mọi trường nguồn (kể cả trường lạ) được sao vào `kyc`; chỉ
 *   `userId` bị bỏ vì đã là khóa cha. Hồ sơ mồ côi (userId không hợp lệ hoặc không còn
 *   user) được giữ nguyên trong nguồn và báo cáo ở `orphans`, không ném lỗi.
 * - Hồ sơ thiếu trường bắt buộc vẫn được nhúng phần có sẵn, báo cáo ở `incomplete`.
 * - User đã có `kyc` với `recordId` khác: KHÔNG ghi đè, báo `conflicts`, nguồn giữ nguyên.
 *   Lệch `users.kycStatus` so với `kyc.status` chỉ báo cáo ở `statusMismatch`.
 * - Ghi bằng `updateOne` có điều kiện `kyc` chưa có (nguyên tử), không `save(User)`.
 * - Kiểm đếm sau khi áp dụng: mọi `recordId` đã nhúng phải có trong `users`
 *   (`kyc.recordId $in`), lệch thì ném lỗi và KHÔNG tạo chỉ mục.
 * - Chỉ mục (chỉ khi kiểm đếm thỏa): `kyc.status,kyc.createdAt`, `kyc.createdAt`
 *   (hàng đợi duyệt không lọc status), và `kyc.recordId` partial (tra `/kyc/:id`).
 * - Rollback: sao ngược MỌI user đang có `kyc` về `kyc_records` (upsert theo `_id`, nên
 *   thay đổi sau chuyển code và hồ sơ tạo mới đều được giữ), kiểm đủ `_id` rồi mới
 *   `$unset` `kyc` của user đó; bỏ chỉ mục khi mọi bước không lỗi. Không xóa collection.
 */
export const KYC_RECORDS_EMBED_MIGRATION_ID = '026-kyc-records-embed'

export const USERS_COLLECTION = 'users'
export const KYC_RECORDS_COLLECTION = 'kyc_records'

type Doc = Record<string, any>

export interface KycEmbedCollection {
  find(
    filter?: Doc,
    options?: { projection?: Doc }
  ): { toArray(): Promise<Doc[]> }
  countDocuments(filter?: Doc): Promise<number>
  updateOne(filter: Doc, update: Doc): Promise<{ matchedCount: number }>
  replaceOne(
    filter: Doc,
    doc: Doc,
    options?: { upsert?: boolean }
  ): Promise<{ matchedCount: number }>
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: { name?: string; partialFilterExpression?: Doc }
  ): Promise<unknown>
  dropIndex(name: string): Promise<unknown>
}

export interface KycEmbedMigrationDb {
  collection(name: string): KycEmbedCollection
}

export type KycRecordsEmbedMigrationReport = MigrationReport & {
  /** Số hồ sơ nguồn (`kyc_records`) đã đọc. */
  sourceRecords: number
  /** Số hồ sơ sẽ được/đã được nhúng mới. */
  embedded: number
  /** Số hồ sơ phải có trong `users.kyc` sau khi áp dụng (mới + đã có sẵn đúng). */
  expectedEmbedded: number
  /** Số `recordId` tìm thấy trong `users` khi kiểm đếm. */
  verifiedEmbedded: number
  /** Hồ sơ mồ côi `"<_id>:<userId>"`: giữ nguyên trong nguồn. */
  orphans: string[]
  /** Hồ sơ cũ hơn của cùng user: giữ nguyên trong nguồn, không nhúng. */
  superseded: string[]
  /** User đã có `kyc` khác: không ghi đè, nguồn giữ nguyên. */
  conflicts: string[]
  /** Hồ sơ thiếu trường bắt buộc: `"<_id>:<trường,...>"`. */
  incomplete: string[]
  /** `users.kycStatus` lệch `kyc.status` (chỉ báo cáo, không tự sửa). */
  statusMismatch: string[]
  /** Chỉ mục đã (hoặc sẽ) tạo. */
  indexes: string[]
}

export type KycRecordsRollbackReport = MigrationReport & {
  /** Số user có `kyc` nhúng đã xét. */
  embeddedUsers: number
  /** Số hồ sơ đã (hoặc sẽ) sao ngược. */
  restored: number
  /** Chỉ mục đã (hoặc sẽ) bỏ. */
  droppedIndexes: string[]
}

const REQUIRED_FIELDS = [
  'status',
  'idCardNumber',
  'frontCardUrl',
  'backCardUrl',
  'selfieUrl',
] as const

const USER_LOOKUP_CHUNK = 500

const KYC_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
  partialFilterExpression?: Doc
}> = [
  {
    name: 'kyc_status_1_kyc_createdAt_-1',
    keys: { 'kyc.status': 1, 'kyc.createdAt': -1 },
  },
  { name: 'kyc_createdAt_-1', keys: { 'kyc.createdAt': -1 } },
  {
    name: 'kyc_recordId_1',
    keys: { 'kyc.recordId': 1 },
    partialFilterExpression: { 'kyc.recordId': { $exists: true } },
  },
]

const HEX24 = /^[a-f0-9]{24}$/i

function newReport(
  dryRun: boolean,
  id = KYC_RECORDS_EMBED_MIGRATION_ID
): KycRecordsEmbedMigrationReport {
  return {
    migrationId: id,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    sourceRecords: 0,
    embedded: 0,
    expectedEmbedded: 0,
    verifiedEmbedded: 0,
    orphans: [],
    superseded: [],
    conflicts: [],
    incomplete: [],
    statusMismatch: [],
    indexes: [],
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hex(value: unknown): string {
  return String(value)
}

/** userId nguồn -> hex 24 ký tự, hoặc null nếu không hợp lệ (kể cả kiểu ObjectId lưu sai). */
function parseUserKey(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const key = hex(value)
  return HEX24.test(key) ? key.toLowerCase() : null
}

function time(value: unknown): number {
  return value instanceof Date ? value.getTime() : 0
}

/** Mới nhất trước: createdAt giảm dần, rồi _id giảm dần (ổn định, không phụ thuộc thứ tự nguồn). */
function newestFirst(a: Doc, b: Doc): number {
  const byCreated = time(b.createdAt) - time(a.createdAt)
  if (byCreated !== 0) return byCreated
  return hex(b._id) < hex(a._id) ? -1 : hex(b._id) > hex(a._id) ? 1 : 0
}

/** Sao toàn bộ trường nguồn (trừ `_id`, `userId`), điền mặc định cho trường bắt buộc khi thiếu về thời gian/kết quả. */
function toKycInfo(source: Doc, report: KycRecordsEmbedMigrationReport): Doc {
  const info: Doc = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === '_id' || key === 'userId' || value === undefined) continue
    info[key] = value
  }
  info.recordId = source._id
  const createdAt =
    source.createdAt instanceof Date
      ? source.createdAt
      : source._id instanceof ObjectId
        ? source._id.getTimestamp()
        : new Date()
  info.createdAt = createdAt
  info.updatedAt =
    source.updatedAt instanceof Date ? source.updatedAt : createdAt
  info.rejectedReason = source.rejectedReason ?? null
  info.verifiedAt = source.verifiedAt ?? null

  const missing = REQUIRED_FIELDS.filter(
    field => source[field] === undefined || source[field] === null
  )
  if (missing.length > 0) {
    report.incomplete.push(`${hex(source._id)}:${missing.join(',')}`)
  }
  return info
}

async function readUsersById(
  users: KycEmbedCollection,
  keys: string[]
): Promise<Map<string, Doc>> {
  const byId = new Map<string, Doc>()
  for (let i = 0; i < keys.length; i += USER_LOOKUP_CHUNK) {
    const chunk = keys
      .slice(i, i + USER_LOOKUP_CHUNK)
      .map(key => new ObjectId(key))
    const rows = await users
      .find({ _id: { $in: chunk } }, { projection: { kyc: 1, kycStatus: 1 } })
      .toArray()
    for (const row of rows) byId.set(hex(row._id).toLowerCase(), row)
  }
  return byId
}

function hasEmbeddedKyc(user: Doc): boolean {
  return user.kyc !== null && typeof user.kyc === 'object'
}

/** Nhúng `kyc_records` vào `users.kyc` (một hồ sơ mới nhất cho mỗi user). */
export async function migrateKycRecordsToUsers(
  db: KycEmbedMigrationDb,
  options: MigrationOptions = {}
): Promise<KycRecordsEmbedMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const users = db.collection(USERS_COLLECTION)
  const records = await db.collection(KYC_RECORDS_COLLECTION).find({}).toArray()
  report.sourceRecords = records.length
  report.scanned = records.length

  const keyed: Array<{ key: string; record: Doc }> = []
  for (const record of records) {
    const key = parseUserKey(record.userId)
    if (key === null) {
      report.orphans.push(`${hex(record._id)}:${hex(record.userId)}`)
      report.skipped += 1
      continue
    }
    keyed.push({ key, record })
  }

  const usersById = await readUsersById(users, [
    ...new Set(keyed.map(item => item.key)),
  ])

  const byUser = new Map<string, Doc[]>()
  for (const item of keyed) {
    if (!usersById.has(item.key)) {
      report.orphans.push(`${hex(item.record._id)}:${hex(item.record.userId)}`)
      report.skipped += 1
      continue
    }
    const list = byUser.get(item.key) ?? []
    list.push(item.record)
    byUser.set(item.key, list)
  }

  const toWrite: Array<{ userOid: ObjectId; recordOid: ObjectId; info: Doc }> =
    []
  const alreadyIds: ObjectId[] = []

  for (const [key, list] of byUser) {
    const sorted = [...list].sort(newestFirst)
    const [latest, ...older] = sorted as [Doc, ...Doc[]]
    for (const old of older) {
      report.superseded.push(hex(old._id))
      report.skipped += 1
    }
    const user = usersById.get(key) as Doc
    const userOid = new ObjectId(key)
    const recordOid = latest._id as ObjectId

    if (hasEmbeddedKyc(user)) {
      if (hex(user.kyc.recordId) === hex(recordOid)) {
        report.skipped += 1 // đã nhúng từ lần chạy trước
        alreadyIds.push(recordOid)
      } else {
        report.conflicts.push(hex(recordOid))
        report.skipped += 1
      }
      continue
    }

    const info = toKycInfo(latest, report)
    if (
      user.kycStatus !== undefined &&
      info.status !== undefined &&
      user.kycStatus !== info.status
    ) {
      report.statusMismatch.push(key)
    }
    toWrite.push({ userOid, recordOid, info })
  }

  report.embedded = toWrite.length
  report.updated = toWrite.length
  const embeddedIds: ObjectId[] = [...alreadyIds]

  if (!dryRun) {
    for (const item of toWrite) {
      try {
        const result = await users.updateOne(
          {
            _id: item.userOid,
            $or: [{ kyc: { $exists: false } }, { kyc: null }],
          },
          { $set: { kyc: item.info } }
        )
        if (result.matchedCount === 0) {
          // User vừa được nhúng/đổi bởi luồng khác: không ghi đè, nguồn giữ nguyên
          report.conflicts.push(hex(item.recordOid))
          report.embedded -= 1
          report.updated -= 1
          report.skipped += 1
          continue
        }
        embeddedIds.push(item.recordOid)
      } catch (error) {
        report.errors.push(
          `${hex(item.recordOid)} embed failed: ${errorText(error)}`
        )
        report.embedded -= 1
        report.updated -= 1
        report.skipped += 1
      }
    }
  }

  report.expectedEmbedded = dryRun
    ? toWrite.length + alreadyIds.length
    : embeddedIds.length

  if (!dryRun) {
    const found =
      embeddedIds.length > 0
        ? await users.countDocuments({ 'kyc.recordId': { $in: embeddedIds } })
        : 0
    report.verifiedEmbedded = found
    if (found !== embeddedIds.length) {
      throw new Error(
        `${KYC_RECORDS_EMBED_MIGRATION_ID}: count mismatch ` +
          `(expected ${embeddedIds.length}, found ${found})`
      )
    }
    // Chỉ tạo chỉ mục khi dữ liệu đã thỏa kiểm đếm
    for (const index of KYC_INDEXES) {
      await users.createIndex(index.keys, {
        name: index.name,
        ...(index.partialFilterExpression
          ? { partialFilterExpression: index.partialFilterExpression }
          : {}),
      })
      report.indexes.push(index.name)
    }
  } else {
    report.indexes = KYC_INDEXES.map(index => index.name)
  }

  return report
}

/** Sao hồ sơ nhúng về `kyc_records` (upsert theo `_id`), rồi mới `$unset` `kyc` của user đó. */
export async function rollbackKycRecordsEmbed(
  db: KycEmbedMigrationDb,
  options: MigrationOptions = {}
): Promise<KycRecordsRollbackReport> {
  const dryRun = options.dryRun ?? true
  const report: KycRecordsRollbackReport = {
    ...newReport(dryRun, `${KYC_RECORDS_EMBED_MIGRATION_ID}:rollback`),
    embeddedUsers: 0,
    restored: 0,
    droppedIndexes: [],
  }
  const users = db.collection(USERS_COLLECTION)
  const records = db.collection(KYC_RECORDS_COLLECTION)

  // Chỉ cần `_id` và `kyc` của user (không nạp cả document user).
  const embedded = await users
    .find({ 'kyc.recordId': { $exists: true } }, { projection: { kyc: 1 } })
    .toArray()
  report.embeddedUsers = embedded.length
  report.scanned = embedded.length

  let allUnset = true
  for (const user of embedded) {
    const kyc = user.kyc as Doc
    const recordOid = kyc.recordId as ObjectId
    const fields: Doc = { ...kyc }
    delete fields.recordId
    report.restored += 1
    if (dryRun) {
      report.updated += 1
      continue
    }

    try {
      await records.replaceOne(
        { _id: recordOid },
        { ...fields, _id: recordOid, userId: hex(user._id) },
        { upsert: true }
      )
    } catch (error) {
      allUnset = false
      report.errors.push(
        `${hex(recordOid)} copy back failed: ${errorText(error)}`
      )
      continue
    }

    const present = await records.countDocuments({ _id: recordOid })
    if (present !== 1) {
      allUnset = false
      report.errors.push(
        `${hex(recordOid)} not found in ${KYC_RECORDS_COLLECTION} after copy back; kyc kept`
      )
      continue
    }

    await users.updateOne(
      { _id: user._id, 'kyc.recordId': recordOid },
      { $unset: { kyc: '' } }
    )
    report.updated += 1
  }

  if (!dryRun && allUnset) {
    for (const index of KYC_INDEXES) {
      try {
        await users.dropIndex(index.name)
        report.droppedIndexes.push(index.name)
      } catch (error) {
        // Chỉ mục chưa có (đã bỏ trước đó) thì bỏ qua; lỗi khác phải báo
        if (!/index not found/i.test(errorText(error))) {
          report.errors.push(
            `drop index ${index.name} failed: ${errorText(error)}`
          )
        }
      }
    }
  } else if (dryRun) {
    report.droppedIndexes = KYC_INDEXES.map(index => index.name)
  }

  return report
}
