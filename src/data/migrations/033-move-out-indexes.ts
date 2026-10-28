import { safeDropIndex } from './migration.mongo-helpers'
import type { MigrationOptions, MigrationReport } from './migration.types'

export const MOVE_OUT_INDEXES_MIGRATION_ID = '033-move-out-indexes'

type IndexKeys = Record<string, 1 | -1>

/** Khớp chỉ mục cùng tên trong `005-rental-flow-e2e-indexes` và schema trả nhà. */
export const MOVE_OUT_INDEXES: Array<{
  collection: string
  keys: IndexKeys
  options: { name: string; unique?: boolean }
}> = [
  {
    collection: 'move_out_handovers',
    keys: { contractId: 1 },
    options: { name: 'move_out_handovers_contract_unique', unique: true },
  },
  {
    collection: 'deposit_settlement_statements',
    keys: { contractId: 1 },
    options: {
      name: 'deposit_settlement_statements_contract_unique',
      unique: true,
    },
  },
  {
    collection: 'deposit_settlement_statements',
    keys: { status: 1, responseDueAt: 1 },
    options: { name: 'deposit_settlement_statements_status_response_due' },
  },
]

export type DuplicateContract = { _id: unknown; count: number }

export interface MoveOutIndexCollection {
  aggregate(pipeline: object[]): { toArray(): Promise<DuplicateContract[]> }
  createIndex(keys: IndexKeys, options: object): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export interface MoveOutIndexDatabase {
  collection(name: string): MoveOutIndexCollection
}

const DUPLICATES_PIPELINE = [
  { $group: { _id: '$contractId', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]

/**
 * Tạo chỉ mục cho hai collection trả nhà. Còn hợp đồng có nhiều hơn một bản ghi thì
 * báo trong `errors` và không tạo chỉ mục nào (chạy lại sau khi xử lý tay);
 * migration không sửa hay xoá tài liệu nào. Tạo lại chỉ mục đã có là thao tác rỗng.
 */
export async function ensureMoveOutIndexes(
  database: MoveOutIndexDatabase,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? true
  const errors: string[] = []
  const uniqueCollections = new Set(
    MOVE_OUT_INDEXES.filter(index => index.options.unique).map(
      index => index.collection
    )
  )
  for (const collection of uniqueCollections) {
    const duplicates = await database
      .collection(collection)
      .aggregate(DUPLICATES_PIPELINE)
      .toArray()
    for (const duplicate of duplicates)
      errors.push(
        `Trùng contractId ${String(duplicate._id)} trong ${collection} (${duplicate.count} bản ghi)`
      )
  }
  const canCreate = errors.length === 0
  if (canCreate && !dryRun) {
    for (const { collection, keys, options: indexOptions } of MOVE_OUT_INDEXES)
      await database.collection(collection).createIndex(keys, indexOptions)
  }
  return {
    migrationId: MOVE_OUT_INDEXES_MIGRATION_ID,
    scanned: MOVE_OUT_INDEXES.length,
    updated: canCreate && !dryRun ? MOVE_OUT_INDEXES.length : 0,
    skipped: canCreate ? 0 : MOVE_OUT_INDEXES.length,
    errors,
    dryRun,
  }
}

export async function rollbackMoveOutIndexes(
  database: MoveOutIndexDatabase,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? true
  let dropped = 0
  if (!dryRun) {
    for (const { collection, options: indexOptions } of MOVE_OUT_INDEXES) {
      const done = await safeDropIndex(
        database.collection(collection),
        indexOptions.name
      )
      if (done) dropped += 1
    }
  }
  return {
    migrationId: MOVE_OUT_INDEXES_MIGRATION_ID,
    scanned: MOVE_OUT_INDEXES.length,
    updated: dropped,
    skipped: MOVE_OUT_INDEXES.length - dropped,
    errors: [],
    dryRun,
  }
}
