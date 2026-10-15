import type { ObjectId } from 'mongodb'
import { MAX_CONTRACT_AMENDMENTS } from '../../modules/contracts/schemas/contract.schema'
import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-AMD: nhúng collection `contract_amendments` vào `contracts.amendments[]`.
 *
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - KHÔNG giả định collection cũ có unique: DB thật có thể chứa trùng `(contractId, sequence)`
 *   và trùng `idempotencyKey`. Các dòng trùng được NHÚNG ĐỦ, không từ chối, không dedup,
 *   chỉ được báo cáo qua `duplicateSequenceContractIds`.
 * - Idempotent theo `_id`: phụ lục đã có trong `amendments[]` bị bỏ qua; `_id` cũ được giữ.
 * - KHÔNG xóa dữ liệu: `contract_amendments` không bị sửa/xóa. Phụ lục mồ côi (`contractId`
 *   không còn hợp đồng) được GIỮ NGUYÊN ở collection cũ và báo cáo `orphanAmendments`.
 * - Vượt trần `MAX_CONTRACT_AMENDMENTS`: không cắt dữ liệu, báo `oversizedContractIds`,
 *   dừng bước của hợp đồng đó, giữ nguyên ở collection cũ.
 * - Sau khi ghi, kiểm đếm theo `_id` cho từng hợp đồng; lệch thì ghi lỗi và DỪNG (không tạo chỉ mục).
 * - Chỉ mục multikey `contracts.amendments.status,effectiveFrom` và `contracts.amendments._id`
 *   chỉ được tạo khi lần áp dụng không có lỗi nào. Không tạo chỉ mục unique.
 * - `rollbackContractAmendmentsEmbed`: bỏ chỉ mục đã tạo, sao ngược MỌI phụ lục đang nhúng
 *   (kể cả phụ lục thêm/đổi sau chuyển code) về `contract_amendments` bằng upsert theo `_id`,
 *   rồi mới `$unset` `amendments` của hợp đồng nếu sao ngược đủ. Không xóa dòng cũ.
 */
export const CONTRACT_AMENDMENTS_EMBED_MIGRATION_ID =
  '027-contract-amendments-embed'

const SOURCE_COLLECTION = 'contract_amendments'
const TARGET_COLLECTION = 'contracts'

export const AMENDMENT_STATUS_EFFECTIVEFROM_INDEX =
  'contracts_amendments_status_effectiveFrom'
export const AMENDMENT_ID_INDEX = 'contracts_amendments_id'

type Doc = Record<string, unknown>

export interface MigrationCollection {
  find(
    filter?: Doc,
    options?: { projection?: Doc; sort?: Record<string, 1 | -1> }
  ): { toArray(): Promise<Doc[]> }
  countDocuments(filter?: Doc): Promise<number>
  updateOne(
    filter: Doc,
    update: Doc
  ): Promise<{ matchedCount: number; modifiedCount?: number }>
  replaceOne(
    filter: Doc,
    doc: Doc,
    options?: { upsert?: boolean }
  ): Promise<{ matchedCount: number }>
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: { name?: string; unique?: boolean; partialFilterExpression?: Doc }
  ): Promise<unknown>
  dropIndex(name: string): Promise<unknown>
}

export interface ContractAmendmentsMigrationDb {
  collection(name: string): MigrationCollection
}

export type ContractAmendmentsMigrationReport = MigrationReport & {
  /** Số dòng `contract_amendments` đã đọc. */
  sourceAmendments: number
  /** Số dòng nguồn đã có mặt (đã nhúng hoặc vừa nhúng) trong hợp đồng của nó. */
  embeddedAmendments: number
  /** Sau khi áp dụng: số dòng nguồn đã kiểm tra thấy trong `amendments[]`. */
  verifiedAmendments: number
  /** Dòng có `contractId` không còn hợp đồng: giữ nguyên, không nhúng. */
  orphanAmendments: number
  orphanContractIds: string[]
  /** Hợp đồng vượt trần: không nhúng, giữ nguyên ở collection cũ. */
  oversizedContractIds: string[]
  /** Hợp đồng có `sequence` trùng trong dữ liệu cũ: vẫn nhúng đủ, chỉ báo cáo. */
  duplicateSequenceContractIds: string[]
  /** Tên chỉ mục đã tạo (chỉ khi áp dụng sạch) hoặc đã bỏ (rollback). */
  indexesCreated: string[]
  indexesDropped: string[]
}

function newReport(
  dryRun: boolean,
  id = CONTRACT_AMENDMENTS_EMBED_MIGRATION_ID
): ContractAmendmentsMigrationReport {
  return {
    migrationId: id,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    sourceAmendments: 0,
    embeddedAmendments: 0,
    verifiedAmendments: 0,
    orphanAmendments: 0,
    orphanContractIds: [],
    oversizedContractIds: [],
    duplicateSequenceContractIds: [],
    indexesCreated: [],
    indexesDropped: [],
  }
}

function idsOf(entries: unknown): Set<string> {
  const set = new Set<string>()
  if (Array.isArray(entries)) {
    for (const entry of entries as Doc[]) set.add(String(entry._id))
  }
  return set
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Bản nhúng của một dòng nguồn: bỏ `contractId` (hợp đồng cha đã mang khóa). */
function toEmbedded(row: Doc): Doc {
  const { contractId: _contractId, ...rest } = row
  void _contractId
  return rest
}

function hasDuplicateSequence(rows: Doc[]): boolean {
  const seen = new Set<string>()
  for (const row of rows) {
    const key = String(row.sequence)
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

export async function migrateContractAmendmentsToEmbedded(
  db: ContractAmendmentsMigrationDb,
  options: MigrationOptions = {}
): Promise<ContractAmendmentsMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const contracts = db.collection(TARGET_COLLECTION)
  const legacy = db.collection(SOURCE_COLLECTION)

  // Chỉ cần `_id` và `amendments` của hợp đồng (không nạp cả document).
  const contractDocs = await contracts
    .find({}, { projection: { amendments: 1 } })
    .toArray()
  const contractIds = new Set(contractDocs.map(c => String(c._id)))

  const sourceRows = await legacy.find({}).toArray()
  report.sourceAmendments = sourceRows.length

  const rowsByContract = new Map<string, Doc[]>()
  const orphanIds = new Set<string>()
  for (const row of sourceRows) {
    const contractId = String(row.contractId)
    if (!contractIds.has(contractId)) {
      report.orphanAmendments += 1
      orphanIds.add(contractId)
      continue
    }
    const list = rowsByContract.get(contractId) ?? []
    list.push(row)
    rowsByContract.set(contractId, list)
  }
  report.orphanContractIds = [...orphanIds]
  report.skipped += report.orphanAmendments

  for (const contract of contractDocs) {
    report.scanned += 1
    const contractId = String(contract._id)
    const rows = (rowsByContract.get(contractId) ?? []).sort(
      (a, b) => Number(a.sequence) - Number(b.sequence)
    )
    if (rows.length === 0) {
      report.skipped += 1
      continue
    }

    const existing = idsOf(contract.amendments)
    const missing = rows.filter(r => !existing.has(String(r._id)))
    const union = [
      ...(Array.isArray(contract.amendments)
        ? (contract.amendments as Doc[])
        : []),
      ...missing,
    ]
    if (hasDuplicateSequence(union)) {
      report.duplicateSequenceContractIds.push(contractId)
    }

    report.embeddedAmendments += rows.length
    if (missing.length === 0) {
      report.skipped += 1
      continue
    }
    if (existing.size + missing.length > MAX_CONTRACT_AMENDMENTS) {
      report.skipped += 1
      report.oversizedContractIds.push(contractId)
      report.errors.push(
        `contract ${contractId}: ${existing.size + missing.length} amendments exceed the ${MAX_CONTRACT_AMENDMENTS} cap; not migrated`
      )
      continue
    }

    report.updated += 1
    if (dryRun) continue

    const missingIds = missing.map(r => r._id as ObjectId)
    await contracts.updateOne(
      { _id: contract._id, 'amendments._id': { $nin: missingIds } },
      {
        $push: {
          amendments: {
            $each: missing.map(toEmbedded),
            $sort: { sequence: 1 },
          },
        },
      }
    )

    // Kiểm đếm theo _id: mọi dòng nguồn của hợp đồng phải nằm trong amendments[].
    const [after] = await contracts
      .find({ _id: contract._id }, { projection: { amendments: 1 } })
      .toArray()
    const embedded = idsOf(after?.amendments)
    const lacking = rows.filter(r => !embedded.has(String(r._id)))
    if (lacking.length > 0) {
      report.errors.push(
        `contract ${contractId}: ${lacking.length}/${rows.length} amendments missing after apply; stopped`
      )
      return report
    }
    report.verifiedAmendments += rows.length
  }

  if (!dryRun && report.errors.length === 0) {
    await contracts.createIndex(
      { 'amendments.status': 1, 'amendments.effectiveFrom': 1 },
      { name: AMENDMENT_STATUS_EFFECTIVEFROM_INDEX }
    )
    report.indexesCreated.push(AMENDMENT_STATUS_EFFECTIVEFROM_INDEX)
    await contracts.createIndex(
      { 'amendments._id': 1 },
      { name: AMENDMENT_ID_INDEX }
    )
    report.indexesCreated.push(AMENDMENT_ID_INDEX)
  }

  return report
}

/**
 * Hoàn tác: bỏ chỉ mục đã tạo; với mỗi hợp đồng đang có `amendments`, sao ngược từng
 * phụ lục nhúng về `contract_amendments` (upsert theo `_id`), rồi mới `$unset`
 * `amendments` nếu sao ngược đủ và không lỗi. Không xóa dòng ở collection cũ.
 * Dry-run mặc định.
 */
export async function rollbackContractAmendmentsEmbed(
  db: ContractAmendmentsMigrationDb,
  options: MigrationOptions = {}
): Promise<ContractAmendmentsMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(
    dryRun,
    `${CONTRACT_AMENDMENTS_EMBED_MIGRATION_ID}:rollback`
  )
  const contracts = db.collection(TARGET_COLLECTION)
  const legacy = db.collection(SOURCE_COLLECTION)

  const embeddedContracts = await contracts
    .find({ amendments: { $exists: true } }, { projection: { amendments: 1 } })
    .toArray()

  if (!dryRun) {
    for (const name of [
      AMENDMENT_STATUS_EFFECTIVEFROM_INDEX,
      AMENDMENT_ID_INDEX,
    ]) {
      try {
        await contracts.dropIndex(name)
        report.indexesDropped.push(name)
      } catch (error) {
        if (!/not found|ns not found|index not found/i.test(errorText(error))) {
          report.errors.push(`drop index ${name} failed: ${errorText(error)}`)
        }
      }
    }
  }

  for (const contract of embeddedContracts) {
    report.scanned += 1
    const contractId = String(contract._id)
    const embedded = (
      Array.isArray(contract.amendments) ? contract.amendments : []
    ) as Doc[]
    report.embeddedAmendments += embedded.length
    if (dryRun) {
      report.updated += 1
      continue
    }

    let ok = true
    for (const item of embedded) {
      try {
        await legacy.replaceOne(
          { _id: item._id },
          { ...item, contractId },
          { upsert: true }
        )
      } catch (error) {
        ok = false
        report.errors.push(
          `${contractId}:${String(item._id)} copy back failed: ${errorText(error)}`
        )
      }
    }

    if (ok) {
      const restored = await legacy
        .find({ contractId }, { projection: { _id: 1 } })
        .toArray()
      const ids = new Set(restored.map(r => String(r._id)))
      const lacking = embedded.filter(item => !ids.has(String(item._id)))
      if (lacking.length > 0) {
        ok = false
        report.errors.push(
          `contract ${contractId}: ${lacking.length} amendments not restored; amendments[] kept`
        )
      }
    }
    if (!ok) continue

    await contracts.updateOne(
      { _id: contract._id },
      { $unset: { amendments: '' } }
    )
    report.verifiedAmendments += embedded.length
    report.updated += 1
  }

  return report
}
