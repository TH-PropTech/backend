import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-LEG: sao `legal_knowledge_docs` (kind='knowledge'), `legal_sources`
 * (kind='source'), `platform_regulations` (kind='regulation') và
 * `legal_terms_documents` (kind='terms') sang collection mới `legal_documents`,
 * GIỮ `_id` cũ của từng bản ghi (chunk `legal_knowledge_chunks.docId`, trích dẫn
 * chat và `PlatformRegulation.linkedSourceKey -> LegalSource.key` vẫn đúng).
 *
 * - `LegalSource.kind` (LegalSourceKind) được đổi thành `docKind` ở đích, vì `kind`
 *   là discriminator của hợp nhất. Mọi bản ghi kind='source' được trả lại `kind` cũ.
 * - `legal_knowledge_chunks` và `policies` KHÔNG thuộc migration này.
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - Idempotent: `updateOne(..., { $setOnInsert }, { upsert: true })` theo `_id`;
 *   bản ghi đã có ở đích bị bỏ qua. Bản ghi thiếu hoặc sai kiểu khóa nghiệp vụ,
 *   trùng `key`/`code`, được sao NGUYÊN và chỉ ghi cảnh báo (không bịa giá trị).
 *   Dòng xung đột (cùng `_id` khác kind ở đích hoặc trùng giữa hai nguồn) không được ghi, chỉ báo vào `errors` (không checkpoint); các dòng còn lại vẫn được sao.
 * - Kiểm đếm theo kind sau khi áp dụng: mọi `_id` nguồn phải có ở đích đúng kind,
 *   lệch thì lỗi và dừng.
 * - Chỉ mục khi áp dụng: (kind, ...) thường cho mọi truy vấn, và hai UNIQUE theo
 *   partial index: `key` khi `kind='source'`, `code` khi `kind='regulation'`.
 *   Unique chỉ được tạo khi dữ liệu thực sự không trùng (kiểm đếm trước, giá trị
 *   thiếu tính là null như Mongo). Nếu trùng, tạo chỉ mục THƯỜNG cùng tên và ghi
 *   cảnh báo `unique skipped: N duplicate keys`. TypeORM Mongo không tạo được partial
 *   index nên migration tạo tất cả.
 * - Rollback: `_id` có ở cả hai bên: `replaceOne` bản cũ bằng bản ở đích (bỏ
 *   `kind`, trả `docKind` về `kind` với source), để trạng thái đổi sau khi chuyển
 *   code không mất; `_id` chỉ có ở đích: chèn ngược vào collection cũ. Chỉ khi
 *   collection cũ chứa đủ `_id` của kind đó mới xóa kind đó khỏi `legal_documents`
 *   (lệch thì báo lỗi, giữ nguyên). Cuối cùng bỏ các chỉ mục.
 * - Không xóa collection cũ.
 */
export const LEGAL_DOCUMENTS_MERGE_MIGRATION_ID = '020-legal-documents-merge'

export const LEGAL_DOCUMENTS_COLLECTION = 'legal_documents'

export type LegalDocumentKindName =
  | 'knowledge'
  | 'source'
  | 'terms'
  | 'regulation'

type Doc = Record<string, unknown> & { _id: unknown }

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface LegalDocumentMongoCollection {
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
    options?: LegalDocumentIndexCreateOptions
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export type LegalDocumentIndexCreateOptions = {
  name?: string
  unique?: boolean
  partialFilterExpression?: Record<string, unknown>
}

export interface LegalDocumentMongoDatabase {
  collection(name: string): LegalDocumentMongoCollection
}

export type LegalDocumentKindCount = { source: number; target: number }

export type LegalDocumentMigrationReport = MigrationReport & {
  counts: Record<LegalDocumentKindName, LegalDocumentKindCount>
  /** Rollback: số bản ghi được sao ngược (mới hoặc đã đổi sau khi chuyển code) về collection cũ. */
  restored: number
  /** Cảnh báo dữ liệu bẩn (không làm dừng migration, không mất dòng nào). */
  warnings: string[]
}

export type LegalDocumentSource = {
  kind: LegalDocumentKindName
  collection: string
  /** Khóa nghiệp vụ bắt buộc ở collection cũ (knowledge không có). */
  requiredKey?: 'key' | 'code'
  /** Khóa duy nhất trong từng loại (source: key, regulation: code). */
  uniqueKey?: 'key' | 'code'
}

export const LEGAL_DOCUMENT_SOURCES: readonly LegalDocumentSource[] = [
  { kind: 'knowledge', collection: 'legal_knowledge_docs' },
  {
    kind: 'source',
    collection: 'legal_sources',
    requiredKey: 'key',
    uniqueKey: 'key',
  },
  {
    kind: 'regulation',
    collection: 'platform_regulations',
    requiredKey: 'code',
    uniqueKey: 'code',
  },
  {
    kind: 'terms',
    collection: 'legal_terms_documents',
    requiredKey: 'key',
  },
]

/** Khớp `LEGAL_DOCUMENT_INDEXES` (schemas/legal-document.schema.ts). */
export const LEGAL_DOCUMENT_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
  options: {
    unique?: boolean
    partialFilterExpression?: Record<string, unknown>
  }
}> = [
  {
    name: 'legal_documents_kind_created_at',
    keys: { kind: 1, createdAt: -1 },
    options: {},
  },
  {
    name: 'legal_documents_kind_status_created_at',
    keys: { kind: 1, status: 1, createdAt: -1 },
    options: {},
  },
  { name: 'legal_documents_kind_key', keys: { kind: 1, key: 1 }, options: {} },
  {
    name: 'legal_documents_kind_order',
    keys: { kind: 1, order: 1 },
    options: {},
  },
  {
    name: 'legal_documents_kind_linked_source_key',
    keys: { kind: 1, linkedSourceKey: 1 },
    options: {},
  },
  {
    name: 'legal_documents_terms_key_status_version',
    keys: { kind: 1, key: 1, status: 1, version: 1 },
    options: {},
  },
  {
    name: 'legal_documents_source_key_unique',
    keys: { key: 1 },
    options: { unique: true, partialFilterExpression: { kind: 'source' } },
  },
  {
    name: 'legal_documents_regulation_code_unique',
    keys: { code: 1 },
    options: { unique: true, partialFilterExpression: { kind: 'regulation' } },
  },
]

/** Ánh xạ bản ghi cũ sang LegalDocument (không gồm `_id`); mọi trường khác giữ nguyên. */
export function toLegalDocumentRow(
  source: LegalDocumentSource,
  legacy: Doc
): Record<string, unknown> {
  const { _id: _unused, ...rest } = legacy
  void _unused
  if (source.kind === 'source') {
    const { kind: legacyKind, ...others } = rest
    // Source cũ thiếu `kind` thì không bịa `docKind`.
    if (legacyKind === undefined) return { kind: 'source', ...others }
    return { kind: 'source', docKind: legacyKind, ...others }
  }
  return { kind: source.kind, ...rest }
}

/** Ánh xạ ngược: bỏ `kind` (và `docKind` của source đổi lại thành `kind`), không gồm `_id`. */
export function fromLegalDocumentRow(
  source: LegalDocumentSource,
  row: Doc
): Record<string, unknown> {
  const { _id: _unused, kind: _kind, ...rest } = row
  void _unused
  void _kind
  if (source.kind === 'source') {
    const { docKind, ...others } = rest
    if (docKind === undefined) return others
    return { ...others, kind: docKind }
  }
  return rest
}

/**
 * Số khóa trị bị trùng trong `rows` theo `field` (giá trị thiếu tính là null, như chỉ mục
 * unique của Mongo). Đếm số GIÁ TRỊ xuất hiện từ hai lần trở lên.
 */
export function countDuplicateKeys(
  rows: readonly Doc[],
  field: string
): number {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = row[field] === undefined ? null : row[field]
    const key = JSON.stringify(value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let duplicates = 0
  for (const n of counts.values()) {
    if (n > 1) duplicates += 1
  }
  return duplicates
}

function newReport(dryRun: boolean): LegalDocumentMigrationReport {
  return {
    migrationId: LEGAL_DOCUMENTS_MERGE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    restored: 0,
    warnings: [],
    counts: {
      knowledge: { source: 0, target: 0 },
      source: { source: 0, target: 0 },
      terms: { source: 0, target: 0 },
      regulation: { source: 0, target: 0 },
    },
  }
}

/**
 * Sao bốn collection cũ sang `legal_documents` theo `_id` (giữ `_id`, idempotent),
 * kiểm đếm theo kind, rồi tạo chỉ mục. Không xóa/sửa collection cũ.
 * `dryRun` chỉ đọc và đếm. Dữ liệu bẩn chỉ ghi cảnh báo; lỗi (dừng TRƯỚC khi ghi)
 * chỉ khi `_id` trùng giữa các nguồn hoặc trùng với bản ghi kind khác ở đích.
 */
export async function migrateLegalDocuments(
  database: LegalDocumentMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<LegalDocumentMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(LEGAL_DOCUMENTS_COLLECTION)
  const plan: Array<{
    source: LegalDocumentSource
    legacy: Doc
    exists: boolean
  }> = []
  const expectedByKind: Record<LegalDocumentKindName, unknown[]> = {
    knowledge: [],
    source: [],
    terms: [],
    regulation: [],
  }
  const seenIds = new Map<string, LegalDocumentKindName>()

  for (const source of LEGAL_DOCUMENT_SOURCES) {
    const legacyDocs = await database
      .collection(source.collection)
      .find()
      .toArray()
    report.counts[source.kind].source = legacyDocs.length
    for (const legacy of legacyDocs) {
      report.scanned += 1
      const label = `${source.collection}:${String(legacy._id)}`
      if (
        source.requiredKey !== undefined &&
        typeof legacy[source.requiredKey] !== 'string'
      ) {
        report.warnings.push(
          `${label} thiếu hoặc sai kiểu ${source.requiredKey}: giữ nguyên giá trị gốc`
        )
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

  for (const item of plan) {
    if (item.exists) {
      report.skipped += 1
      continue
    }
    report.updated += 1
    if (!dryRun) {
      await target.updateOne(
        { _id: item.legacy._id },
        { $setOnInsert: toLegalDocumentRow(item.source, item.legacy) },
        { upsert: true }
      )
    }
  }

  for (const source of LEGAL_DOCUMENT_SOURCES) {
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
          `${LEGAL_DOCUMENTS_MERGE_MIGRATION_ID}: count mismatch for kind ${source.kind} ` +
            `(expected ${expectedIds.length}, found ${found})`
        )
      }
    }
  }

  for (const index of LEGAL_DOCUMENT_INDEXES) {
    let options: LegalDocumentIndexCreateOptions = { name: index.name }
    if (index.options.unique === true) {
      const kind = String(index.options.partialFilterExpression?.kind)
      const field = String(Object.keys(index.keys)[0])
      // Kiểm trùng trước khi tạo unique: dry-run dùng dữ liệu nguồn, áp dụng dùng đích.
      const rows = dryRun
        ? plan.filter(p => p.source.kind === kind).map(p => p.legacy)
        : await target.find({ kind }).toArray()
      const duplicates = countDuplicateKeys(rows, field)
      if (duplicates > 0) {
        report.warnings.push(
          `${index.name}: unique skipped: ${duplicates} duplicate keys`
        )
      } else {
        options = { name: index.name, ...index.options }
      }
    }
    if (!dryRun) {
      await target.createIndex(index.keys, options)
    }
  }

  return report
}

/**
 * Rollback (dry-run mặc định), theo từng kind:
 * 1. `_id` có ở cả hai bên: `replaceOne` bản cũ bằng bản ở đích (bỏ `kind`, trả
 *    `docKind` về `kind` với source), để trạng thái đổi sau khi chuyển code không mất;
 * 2. `_id` chỉ có ở đích (tạo sau khi chuyển code): chèn vào collection cũ;
 * 3. chỉ khi collection cũ chứa đủ các `_id` của kind đó mới xóa kind đó khỏi
 *    `legal_documents` (lệch thì báo lỗi, giữ nguyên kind);
 * 4. bỏ chỉ mục (khi không có lỗi).
 * Bản ghi chỉ có ở collection cũ (không có ở đích) được giữ nguyên, tính vào `skipped`.
 * `updated` = số bản ghi bị xóa khỏi đích (hoặc sẽ bị xóa khi dry-run);
 * `restored` = số bản ghi ghi ngược về collection cũ.
 */
export async function rollbackLegalDocuments(
  database: LegalDocumentMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<LegalDocumentMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(LEGAL_DOCUMENTS_COLLECTION)

  for (const source of LEGAL_DOCUMENT_SOURCES) {
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
      const legacyDoc = fromLegalDocumentRow(source, row)
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
          `${LEGAL_DOCUMENTS_COLLECTION} kind=${source.kind} kept`
      )
      report.updated -= rows.length
      report.restored -= rows.length - have
      continue
    }
    await target.deleteMany({ kind: source.kind })
  }

  for (const source of LEGAL_DOCUMENT_SOURCES) {
    report.counts[source.kind].target = await target.countDocuments({
      kind: source.kind,
    })
  }

  if (!dryRun && report.errors.length === 0) {
    for (const index of LEGAL_DOCUMENT_INDEXES) {
      try {
        await target.dropIndex(index.name)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
  }

  return report
}
