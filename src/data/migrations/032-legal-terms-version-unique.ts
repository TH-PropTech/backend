import { safeDropIndex } from './migration.mongo-helpers'
import type { MigrationOptions, MigrationReport } from './migration.types'

export const LEGAL_TERMS_VERSION_UNIQUE_MIGRATION_ID =
  '032-legal-terms-version-unique'
export const LEGAL_DOCUMENTS_COLLECTION = 'legal_documents'

/** Khớp chỉ mục cùng tên trong `LEGAL_DOCUMENT_INDEXES` (schemas/legal-document.schema.ts). */
export const LEGAL_TERMS_VERSION_UNIQUE_INDEX = {
  name: 'legal_documents_terms_key_version_published_unique',
  keys: { key: 1, version: 1 } as Record<string, 1 | -1>,
  options: {
    unique: true,
    partialFilterExpression: { kind: 'terms', status: 'published' },
  },
}

export type DuplicateTermsVersion = {
  _id: { key: string; version: number }
  ids: unknown[]
  count: number
}

/** Tập con của `Collection` trong mongodb driver mà migration cần. */
export interface LegalTermsIndexCollection {
  aggregate(pipeline: object[]): { toArray(): Promise<DuplicateTermsVersion[]> }
  createIndex(
    keys: Record<string, 1 | -1>,
    options: Record<string, unknown>
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export interface LegalTermsIndexDatabase {
  collection(name: string): LegalTermsIndexCollection
}

const DUPLICATES_PIPELINE = [
  { $match: { kind: 'terms', status: 'published' } },
  {
    $group: {
      _id: { key: '$key', version: '$version' },
      ids: { $push: '$_id' },
      count: { $sum: 1 },
    },
  },
  { $match: { count: { $gt: 1 } } },
]

/**
 * Tạo partial unique index cho bản điều khoản đã xuất bản. Còn bản trùng thì
 * báo trong `errors` và không tạo (không checkpoint, chạy lại sau khi xử lý tay);
 * migration không sửa hay xoá tài liệu nào.
 */
export async function ensureLegalTermsVersionUnique(
  database: LegalTermsIndexDatabase,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? true
  const collection = database.collection(LEGAL_DOCUMENTS_COLLECTION)
  const duplicates = await collection.aggregate(DUPLICATES_PIPELINE).toArray()
  const errors = duplicates.map(
    d =>
      `Trùng điều khoản ${d._id.key} v${d._id.version}: ${d.ids.map(String).join(', ')}`
  )
  const canCreate = errors.length === 0
  if (canCreate && !dryRun) {
    const {
      name,
      keys,
      options: indexOptions,
    } = LEGAL_TERMS_VERSION_UNIQUE_INDEX
    await collection.createIndex(keys, { name, ...indexOptions })
  }
  return {
    migrationId: LEGAL_TERMS_VERSION_UNIQUE_MIGRATION_ID,
    scanned: duplicates.length,
    updated: canCreate && !dryRun ? 1 : 0,
    skipped: canCreate ? 0 : 1,
    errors,
    dryRun,
  }
}

export async function rollbackLegalTermsVersionUnique(
  database: LegalTermsIndexDatabase,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? true
  const dropped = dryRun
    ? false
    : await safeDropIndex(
        database.collection(LEGAL_DOCUMENTS_COLLECTION),
        LEGAL_TERMS_VERSION_UNIQUE_INDEX.name
      )
  return {
    migrationId: LEGAL_TERMS_VERSION_UNIQUE_MIGRATION_ID,
    scanned: 1,
    updated: dropped ? 1 : 0,
    skipped: dropped ? 0 : 1,
    errors: [],
    dryRun,
  }
}
