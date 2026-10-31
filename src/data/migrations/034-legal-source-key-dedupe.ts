import { safeIndexes } from './migration.mongo-helpers'
import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * Dọn `legal_documents` kind='source' trùng `key` (migration 020 bỏ qua chỉ mục unique khi gặp
 * trùng), giữ bản `updatedAt` mới nhất (hòa thì `_id` lớn hơn), xóa các bản còn lại rồi tạo
 * `legal_documents_source_key_unique`. Bản ghi thiếu `key` không bị đụng; nếu có từ hai bản như
 * vậy thì chỉ mục không được tạo (cảnh báo). Idempotent; mặc định dry-run.
 * Không đảo ngược được: `removed` trong báo cáo giữ nguyên nội dung bản đã xóa để khôi phục tay.
 */
export const LEGAL_SOURCE_KEY_DEDUPE_MIGRATION_ID =
  '034-legal-source-key-dedupe'
export const LEGAL_DOCUMENTS_COLLECTION = 'legal_documents'

/** Khớp chỉ mục cùng tên trong `LEGAL_DOCUMENT_INDEXES` (schemas/legal-document.schema.ts). */
export const LEGAL_SOURCE_KEY_UNIQUE_INDEX = {
  name: 'legal_documents_source_key_unique',
  keys: { key: 1 } as Record<string, 1 | -1>,
  options: { unique: true, partialFilterExpression: { kind: 'source' } },
}

type Doc = Record<string, unknown> & { _id: unknown }
type IndexInfo = { name?: string; unique?: boolean }

/** Tập con của `Collection` trong mongodb driver mà migration cần. */
export interface LegalSourceDedupeCollection {
  find(filter: Record<string, unknown>): { toArray(): Promise<Doc[]> }
  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount?: number }>
  indexes(): Promise<IndexInfo[]>
  createIndex(
    keys: Record<string, 1 | -1>,
    options: Record<string, unknown>
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export interface LegalSourceDedupeDatabase {
  collection(name: string): LegalSourceDedupeCollection
}

export type LegalSourceDedupeReport = MigrationReport & {
  /** Nội dung đầy đủ các bản đã (hoặc sẽ) xóa. */
  removed: Doc[]
  warnings: string[]
}

function timeOf(doc: Doc): number {
  const value = doc['updatedAt']
  if (value === undefined || value === null) return 0
  const time =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
        ? Date.parse(value)
        : NaN
  return Number.isNaN(time) ? 0 : time
}

function idOf(doc: Doc): string {
  const id = doc._id
  return typeof id === 'string' ? id : JSON.stringify(id)
}

/** Âm khi `a` nên đứng trước `b` (a mới hơn). */
function newestFirst(a: Doc, b: Doc): number {
  const byTime = timeOf(b) - timeOf(a)
  if (byTime !== 0) return byTime
  const idA = idOf(a)
  const idB = idOf(b)
  if (idA === idB) return 0
  return idA < idB ? 1 : -1
}

function findRemovals(sources: readonly Doc[]): {
  removed: Doc[]
  keyless: number
} {
  const groups = new Map<string, Doc[]>()
  let keyless = 0
  for (const doc of sources) {
    const key = doc['key']
    if (typeof key !== 'string') {
      keyless += 1
      continue
    }
    groups.set(key, [...(groups.get(key) ?? []), doc])
  }
  const removed: Doc[] = []
  for (const docs of groups.values()) {
    if (docs.length > 1) removed.push(...[...docs].sort(newestFirst).slice(1))
  }
  return { removed, keyless }
}

/** Trả `true` khi đã tạo chỉ mục unique (gỡ chỉ mục thường cùng tên do migration 020 để lại). */
async function ensureUniqueIndex(
  collection: LegalSourceDedupeCollection
): Promise<boolean> {
  const { name, keys, options } = LEGAL_SOURCE_KEY_UNIQUE_INDEX
  const existing = (await safeIndexes(collection)).find(i => i.name === name)
  if (existing?.unique === true) return false
  if (existing) await collection.dropIndex(name)
  await collection.createIndex(keys, { name, ...options })
  return true
}

export async function dedupeLegalSourceKeys(
  database: LegalSourceDedupeDatabase,
  options: MigrationOptions = {}
): Promise<LegalSourceDedupeReport> {
  const dryRun = options.dryRun ?? true
  const collection = database.collection(LEGAL_DOCUMENTS_COLLECTION)
  const sources = await collection.find({ kind: 'source' }).toArray()
  const { removed, keyless } = findRemovals(sources)

  const warnings: string[] = []
  if (keyless > 1) {
    warnings.push(
      `${keyless} nguồn thiếu key: không tạo chỉ mục unique, cần xử lý tay`
    )
  }

  let indexCreated = false
  if (!dryRun) {
    if (removed.length > 0) {
      await collection.deleteMany({ _id: { $in: removed.map(d => d._id) } })
    }
    if (keyless <= 1) indexCreated = await ensureUniqueIndex(collection)
  }

  return {
    migrationId: LEGAL_SOURCE_KEY_DEDUPE_MIGRATION_ID,
    scanned: sources.length,
    updated: removed.length + (indexCreated ? 1 : 0),
    skipped: sources.length - removed.length,
    errors: [],
    dryRun,
    removed,
    warnings,
  }
}

/** Chỉ gỡ chỉ mục; bản đã xóa không tự khôi phục được (dùng `removed` trong log). */
export async function rollbackLegalSourceKeyDedupe(
  database: LegalSourceDedupeDatabase,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? true
  let dropped = false
  if (!dryRun) {
    const collection = database.collection(LEGAL_DOCUMENTS_COLLECTION)
    const { name } = LEGAL_SOURCE_KEY_UNIQUE_INDEX
    const existing = (await safeIndexes(collection)).find(i => i.name === name)
    if (existing) {
      await collection.dropIndex(name)
      dropped = true
    }
  }
  return {
    migrationId: LEGAL_SOURCE_KEY_DEDUPE_MIGRATION_ID,
    scanned: 1,
    updated: dropped ? 1 : 0,
    skipped: dropped ? 0 : 1,
    errors: [],
    dryRun,
  }
}
