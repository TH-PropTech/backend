import type { MergeCollection } from './009-community-entries-merge'
import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-DOC: sao `contract_artifacts` (kind='canonical', gồm cả artifact của bản sửa
 * đổi có `amendmentId`) và `contract_signed_artifacts` (kind='signed') sang
 * collection mới `contract_documents`, GIỮ `_id` cũ của từng bản ghi (mọi tham
 * chiếu `Contract.artifactRef.artifactId`, `ContractAmendment.artifactId`,
 * `SmartCaSigningSession.signedArtifactId`, ledger envelope vẫn đúng).
 *
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - Idempotent: `updateOne(..., { $setOnInsert }, { upsert: true })` theo `_id`;
 *   bản ghi đã có ở đích bị bỏ qua. `_id` đã dùng ở đích với kind khác (hoặc bởi
 *   nguồn kia trong cùng lần chạy) được báo lỗi và không ghi đè.
 * - Kiểm đếm theo kind sau khi áp dụng: mọi `_id` nguồn phải có ở đích đúng kind,
 *   lệch thì lỗi và dừng.
 * - Chỉ mục khi áp dụng (production tắt synchronize; TypeORM Mongo cũng không
 *   tạo được partial index):
 *   1. `(kind, contractId, revision)` thường;
 *   2. UNIQUE `(contractId, revision, amendmentId)` với
 *      `partialFilterExpression: { kind: 'canonical' }`. Bản `signed` không bị
 *      unique (giữ hành vi cũ: `revision = latest + 1`, không nguyên tử).
 *   Nếu tạo chỉ mục thất bại (canonical trùng khóa) thì ghi lỗi, dữ liệu đã sao
 *   được giữ nguyên để điều tra.
 * - Ghi chú: index cũ `contract_artifacts_contract_revision_amendment_unique`
 *   (tạo tay ở migration 005) VẪN CÒN trên collection cũ `contract_artifacts`;
 *   migration này không xóa nó và không xóa collection cũ.
 * - Rollback: với `_id` có ở cả hai bên, `replaceOne` bản cũ bằng bản ở
 *   `contract_documents` (bỏ `kind`, bỏ trường chỉ thuộc loại kia khi rỗng, bỏ
 *   `updatedAt` của canonical); `_id` chỉ có ở đích (ghi sau khi chuyển code) được
 *   chèn ngược; `_id` chỉ có ở collection cũ (đã bị xóa sau khi chuyển code) chỉ
 *   được báo cáo trong `deletedAtTarget`, không hồi sinh. Chỉ khi collection cũ đã
 *   chứa đủ mới xóa theo `kind` khỏi `contract_documents`, rồi bỏ 2 chỉ mục.
 */
export const CONTRACT_DOCUMENTS_MERGE_MIGRATION_ID =
  '011-contract-documents-merge'

export const CONTRACT_DOCUMENTS_COLLECTION = 'contract_documents'

type Kind = 'canonical' | 'signed'

const SOURCES: Array<{ kind: Kind; collection: string }> = [
  { kind: 'canonical', collection: 'contract_artifacts' },
  { kind: 'signed', collection: 'contract_signed_artifacts' },
]

/** Khớp `ContractDocument` (schemas/contract-document.schema.ts). */
export const CONTRACT_DOCUMENT_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
  options: Record<string, unknown>
}> = [
  {
    name: 'contract_documents_kind_contract_revision',
    keys: { kind: 1, contractId: 1, revision: 1 },
    options: {},
  },
  {
    name: 'contract_documents_canonical_contract_revision_amendment_unique',
    keys: { contractId: 1, revision: 1, amendmentId: 1 },
    options: { unique: true, partialFilterExpression: { kind: 'canonical' } },
  },
]

/** Trường chỉ thuộc canonical / chỉ thuộc signed (để dọn khi rollback). */
const CANONICAL_ONLY = [
  'templateRef',
  'legalProfile',
  'gridFsFileId',
  'artifactHash',
  'canonicalContentHash',
  'rendererVersion',
  'sourceSchemaVersion',
  'contentType',
  'lockedAt',
]
const SIGNED_ONLY = [
  'signerId',
  'signerRole',
  'canonicalHash',
  'status',
  'errorCode',
  'sessionId',
  'preparedFileId',
  'contentDigest',
  'signedAttrsDigest',
  'signingTime',
  'signerPem',
  'chainPem',
  'signedFileId',
  'sha256',
]

type Doc = Record<string, unknown>

export interface ContractDocumentsCollection extends Omit<
  MergeCollection,
  'createIndex'
> {
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: Record<string, unknown>
  ): Promise<unknown>
}

export interface ContractDocumentsMergeDb {
  collection(name: string): ContractDocumentsCollection
}

export type ContractDocumentsMergeReport = MigrationReport & {
  sourceCounts: Record<Kind, number>
  targetCounts: Record<Kind, number>
  /** Rollback: _id còn ở collection cũ nhưng đã bị xóa ở đích (không hồi sinh). */
  deletedAtTarget: string[]
}

function newReport(dryRun: boolean): ContractDocumentsMergeReport {
  return {
    migrationId: CONTRACT_DOCUMENTS_MERGE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    sourceCounts: { canonical: 0, signed: 0 },
    targetCounts: { canonical: 0, signed: 0 },
    deletedAtTarget: [],
  }
}

export async function migrateContractDocuments(
  db: ContractDocumentsMergeDb,
  options: MigrationOptions = {}
): Promise<ContractDocumentsMergeReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = db.collection(CONTRACT_DOCUMENTS_COLLECTION)

  // Mọi _id đã có ở đích (kèm kind) để nhận biết trùng/va chạm.
  const present = new Map<string, unknown>()
  for (const row of await target
    .find({}, { projection: { _id: 1, kind: 1 } })
    .toArray()) {
    present.set(String(row._id), row.kind)
  }

  for (const { kind, collection } of SOURCES) {
    const source = await db.collection(collection).find({}).toArray()
    report.sourceCounts[kind] = source.length

    for (const doc of source) {
      report.scanned += 1
      const id = String(doc._id)
      if (present.has(id)) {
        report.skipped += 1
        if (present.get(id) !== kind) {
          report.errors.push(
            `${collection}/${id}: _id already used by kind=${String(present.get(id))} in ${CONTRACT_DOCUMENTS_COLLECTION}; not copied`
          )
        }
        continue
      }
      present.set(id, kind)
      report.updated += 1
      if (dryRun) continue
      await target.updateOne(
        { _id: doc._id },
        { $setOnInsert: { ...doc, kind } },
        { upsert: true }
      )
    }

    // Kiểm đếm: mọi _id nguồn phải nằm ở đích đúng kind.
    if (!dryRun) {
      const found = await target.countDocuments({
        kind,
        _id: { $in: source.map(d => d._id) },
      })
      report.targetCounts[kind] = found
      if (found !== source.length) {
        report.errors.push(
          `${collection}: ${found}/${source.length} documents present as kind=${kind} after apply; stopped`
        )
        return report
      }
    }
  }

  if (dryRun) {
    for (const { kind } of SOURCES) {
      report.targetCounts[kind] = await target.countDocuments({ kind })
    }
    return report
  }

  for (const index of CONTRACT_DOCUMENT_INDEXES) {
    try {
      await target.createIndex(index.keys, {
        name: index.name,
        ...index.options,
      })
    } catch (error) {
      report.errors.push(
        `${index.name}: createIndex failed (${error instanceof Error ? error.message : String(error)}); copied documents kept`
      )
      return report
    }
  }
  return report
}

function restoreLegacyShape(entry: Doc, kind: Kind): Doc {
  const restored: Doc = { ...entry }
  delete restored.kind
  // Trường chỉ thuộc loại kia: chỉ bỏ khi rỗng (TypeORM có thể ghi null).
  for (const field of kind === 'canonical' ? SIGNED_ONLY : CANONICAL_ONLY) {
    if (restored[field] === null || restored[field] === undefined) {
      delete restored[field]
    }
  }
  // `updatedAt` của canonical do entity mới thêm; entity cũ không có cột này.
  if (kind === 'canonical') delete restored.updatedAt
  return restored
}

export async function rollbackContractDocuments(
  db: ContractDocumentsMergeDb,
  options: MigrationOptions = {}
): Promise<ContractDocumentsMergeReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = db.collection(CONTRACT_DOCUMENTS_COLLECTION)

  for (const { kind, collection } of SOURCES) {
    const legacy = db.collection(collection)
    const entries = await target.find({ kind }).toArray()
    const entryIds = new Set(entries.map(e => String(e._id)))
    const legacyIds = new Set(
      (await legacy.find({}, { projection: { _id: 1 } }).toArray()).map(d =>
        String(d._id)
      )
    )
    report.targetCounts[kind] = entries.length
    report.sourceCounts[kind] = legacyIds.size

    // _id còn ở collection cũ nhưng đã bị xóa ở đích: chỉ báo cáo.
    for (const id of legacyIds) {
      if (!entryIds.has(id)) report.deletedAtTarget.push(id)
    }

    for (const entry of entries) {
      report.scanned += 1
      report.updated += 1
      if (dryRun) continue
      const restored = restoreLegacyShape(entry, kind)
      if (legacyIds.has(String(entry._id))) {
        // Bản ở đích là bản mới nhất (status, sessionId, sha256, ...).
        await legacy.replaceOne({ _id: entry._id }, restored)
      } else {
        await legacy.insertOne(restored)
      }
    }

    if (dryRun) continue
    // Chỉ xóa khỏi đích khi collection cũ đã chứa đủ.
    const have = await legacy.countDocuments({
      _id: { $in: entries.map(e => e._id) },
    })
    if (have !== entries.length) {
      report.errors.push(
        `${collection}: ${have}/${entries.length} entries restored; ${CONTRACT_DOCUMENTS_COLLECTION} kind=${kind} kept; stopped`
      )
      return report
    }
    await target.deleteMany({ kind })
  }

  if (!dryRun) {
    for (const index of CONTRACT_DOCUMENT_INDEXES) {
      try {
        await target.dropIndex(index.name)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
  }
  return report
}
