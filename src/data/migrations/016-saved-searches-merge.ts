import type { MigrationOptions, MigrationReport } from './migration.types'

export const SAVED_SEARCHES_MERGE_MIGRATION_ID = '016-saved-searches-merge'

export const USER_SEARCHES_COLLECTION = 'user_searches'

export type SavedSearchRecordKindName = 'search' | 'alert'

type Doc = Record<string, unknown> & { _id: unknown }

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface SavedSearchesMongoCollection {
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

export interface SavedSearchesMongoDatabase {
  collection(name: string): SavedSearchesMongoCollection
}

export type SavedSearchesKindCount = { source: number; target: number }

export type SavedSearchesMigrationReport = MigrationReport & {
  counts: Record<SavedSearchRecordKindName, SavedSearchesKindCount>
  /** Rollback: số bản ghi được sao ngược (mới hoặc đã đổi sau khi chuyển code) về collection cũ. */
  restored: number
  /** Cảnh báo dữ liệu bẩn (không làm dừng migration, không mất dòng nào). */
  warnings: string[]
}

export type SavedSearchRecordSource = {
  kind: SavedSearchRecordKindName
  collection: string
}

/**
 * Hai nguồn: `saved_searches` (kind 'search') và `search_alerts` (kind 'alert').
 * Cả hai đều có `userId` (bắt buộc để kiểm quyền sau khi chuyển code).
 */
export const SAVED_SEARCH_RECORD_SOURCES: readonly SavedSearchRecordSource[] = [
  { kind: 'search', collection: 'saved_searches' },
  { kind: 'alert', collection: 'search_alerts' },
]

/**
 * Khớp `SavedSearchRecord` (schemas/saved-search-record.schema.ts). Ba chỉ mục
 * này do migration tạo khi áp dụng (production tắt synchronize).
 * Không có unique nào ở hai entity cũ, nên không có partial unique cần tái tạo.
 */
export const SAVED_SEARCH_RECORD_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
}> = [
  {
    name: 'user_searches_kind_alertEnabled',
    keys: { kind: 1, alertEnabled: 1 },
  },
  {
    name: 'user_searches_kind_userId_createdAt',
    keys: { kind: 1, userId: 1, createdAt: 1 },
  },
  {
    name: 'user_searches_kind_deduplicationKey',
    keys: { kind: 1, deduplicationKey: 1 },
  },
]

/** Ánh xạ bản ghi cũ sang SavedSearchRecord (không gồm `_id`); mọi trường khác giữ nguyên. */
export function toSavedSearchRecordDoc(
  source: SavedSearchRecordSource,
  legacy: Doc
): Record<string, unknown> {
  const { _id: _unused, ...rest } = legacy
  void _unused
  return { kind: source.kind, ...rest }
}

/** Ánh xạ ngược: bỏ `kind` (không gồm `_id`); mọi trường khác giữ nguyên. */
export function fromSavedSearchRecordDoc(row: Doc): Record<string, unknown> {
  const { _id: _unused, kind: _kind, ...rest } = row
  void _unused
  void _kind
  return rest
}

function newReport(dryRun: boolean): SavedSearchesMigrationReport {
  return {
    migrationId: SAVED_SEARCHES_MERGE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    restored: 0,
    warnings: [],
    counts: {
      search: { source: 0, target: 0 },
      alert: { source: 0, target: 0 },
    },
  }
}

/**
 * Sao `saved_searches` và `search_alerts` sang `user_searches` theo `_id` (giữ `_id`
 * cũ, idempotent), rồi tạo chỉ mục. Không xóa/sửa collection cũ.
 * `dryRun` chỉ đọc và đếm. Bản ghi thiếu hoặc sai kiểu `userId` vẫn được sao nguyên
 * và chỉ ghi cảnh báo. Dòng xung đột (cùng `_id` khác kind ở đích hoặc trùng giữa hai nguồn) không được ghi, chỉ báo vào `errors` (không checkpoint); các dòng còn lại vẫn được sao.
 * Sau khi ghi, mọi `_id` nguồn phải có mặt ở đích đúng `kind`, lệch thì ném lỗi.
 */
export async function migrateSavedSearches(
  database: SavedSearchesMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<SavedSearchesMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(USER_SEARCHES_COLLECTION)
  const plan: Array<{
    source: SavedSearchRecordSource
    legacy: Doc
    exists: boolean
  }> = []
  const expectedByKind: Record<SavedSearchRecordKindName, unknown[]> = {
    search: [],
    alert: [],
  }
  const seenIds = new Map<string, SavedSearchRecordKindName>()

  for (const source of SAVED_SEARCH_RECORD_SOURCES) {
    const legacyDocs = await database
      .collection(source.collection)
      .find()
      .toArray()
    report.counts[source.kind].source = legacyDocs.length
    for (const legacy of legacyDocs) {
      report.scanned += 1
      const label = `${source.collection}:${String(legacy._id)}`
      if (typeof legacy.userId !== 'string') {
        report.warnings.push(
          `${label} thiếu hoặc sai kiểu userId: giữ nguyên giá trị gốc`
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
        {
          $setOnInsert: toSavedSearchRecordDoc(item.source, item.legacy),
        },
        { upsert: true }
      )
    }
  }

  for (const source of SAVED_SEARCH_RECORD_SOURCES) {
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
          `${SAVED_SEARCHES_MERGE_MIGRATION_ID}: count mismatch for kind ${source.kind} ` +
            `(expected ${expectedIds.length}, found ${found})`
        )
      }
    }
  }

  if (!dryRun) {
    for (const index of SAVED_SEARCH_RECORD_INDEXES) {
      await target.createIndex(index.keys, { name: index.name })
    }
  }

  return report
}

/**
 * Rollback (dry-run mặc định), theo từng kind:
 * 1. `_id` có ở cả hai bên: `replaceOne` bản cũ bằng bản ở đích (bỏ `kind`), để
 *    trạng thái đổi sau khi chuyển code (đã đọc, đã tắt cảnh báo, matchCount) không mất;
 * 2. `_id` chỉ có ở đích (tạo sau khi chuyển code): chèn vào collection cũ;
 * 3. chỉ khi collection cũ chứa đủ các `_id` của kind đó mới xóa kind đó khỏi
 *    `user_searches` (lệch thì báo lỗi, giữ nguyên kind);
 * 4. bỏ chỉ mục (chỉ khi không có lỗi).
 * Bản ghi chỉ có ở collection cũ (không có ở đích) được giữ nguyên, tính vào `skipped`.
 * `updated` = số bản ghi bị xóa khỏi đích (hoặc sẽ bị xóa khi dry-run);
 * `restored` = số bản ghi ghi ngược về collection cũ.
 */
export async function rollbackSavedSearches(
  database: SavedSearchesMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<SavedSearchesMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(USER_SEARCHES_COLLECTION)

  for (const source of SAVED_SEARCH_RECORD_SOURCES) {
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
      const legacyDoc = fromSavedSearchRecordDoc(row)
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
          `${USER_SEARCHES_COLLECTION} kind=${source.kind} kept`
      )
      report.updated -= rows.length
      report.restored -= rows.length - have
      continue
    }
    await target.deleteMany({ kind: source.kind })
  }

  for (const source of SAVED_SEARCH_RECORD_SOURCES) {
    report.counts[source.kind].target = await target.countDocuments({
      kind: source.kind,
    })
  }

  if (!dryRun && report.errors.length === 0) {
    for (const index of SAVED_SEARCH_RECORD_INDEXES) {
      try {
        await target.dropIndex(index.name)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
  }

  return report
}
