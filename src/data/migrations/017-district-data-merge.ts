import type { MigrationOptions, MigrationReport } from './migration.types'

export const DISTRICT_DATA_MERGE_MIGRATION_ID = '017-district-data-merge'

export const DISTRICT_DATA_COLLECTION = 'district_data'

export type DistrictDataKindName = 'area-profile' | 'risk-layer'

type Doc = Record<string, unknown> & { _id: unknown }

/** Tập con của `Collection` trong mongodb driver mà migration cần (dễ giả lập trong test). */
export interface DistrictDataMongoCollection {
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

export interface DistrictDataMongoDatabase {
  collection(name: string): DistrictDataMongoCollection
}

export type DistrictDataKindCount = { source: number; target: number }

export type DistrictDataMigrationReport = MigrationReport & {
  counts: Record<DistrictDataKindName, DistrictDataKindCount>
  /** Rollback: số bản ghi được sao ngược (mới hoặc đã đổi sau khi chuyển code) về collection cũ. */
  restored: number
  /** Cảnh báo dữ liệu bẩn (không làm dừng migration, không mất dòng nào). */
  warnings: string[]
}

export type DistrictDataSource = {
  kind: DistrictDataKindName
  collection: string
}

export const DISTRICT_DATA_SOURCES: readonly DistrictDataSource[] = [
  { kind: 'area-profile', collection: 'area_profiles' },
  { kind: 'risk-layer', collection: 'risk_layer_data' },
]

/**
 * Chỉ mục phục vụ mọi truy vấn của DistrictData (luôn có `kind` đứng đầu).
 * Hai entity cũ không có unique nào nên không tạo unique nào.
 */
export const DISTRICT_DATA_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
}> = [
  {
    name: 'district_data_kind_district_city',
    keys: { kind: 1, district: 1, city: 1 },
  },
  {
    name: 'district_data_kind_district_timestamp',
    keys: { kind: 1, district: 1, timestamp: 1 },
  },
  {
    name: 'district_data_kind_updatedAt',
    keys: { kind: 1, updatedAt: 1 },
  },
]

/** Ánh xạ bản ghi cũ sang DistrictData (giữ `_id`, thêm `kind`; mọi trường khác giữ nguyên). */
export function toDistrictDataDoc(
  source: DistrictDataSource,
  legacy: Doc
): Record<string, unknown> {
  const { _id: _unused, ...rest } = legacy
  void _unused
  return { ...rest, kind: source.kind }
}

/** Ánh xạ ngược: bỏ `kind` (không gồm `_id`); mọi trường khác giữ nguyên. */
export function fromDistrictDataDoc(row: Doc): Record<string, unknown> {
  const { _id: _unused, kind: _kind, ...rest } = row
  void _unused
  void _kind
  return rest
}

function newReport(dryRun: boolean): DistrictDataMigrationReport {
  return {
    migrationId: DISTRICT_DATA_MERGE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    restored: 0,
    warnings: [],
    counts: {
      'area-profile': { source: 0, target: 0 },
      'risk-layer': { source: 0, target: 0 },
    },
  }
}

/**
 * Sao `area_profiles` và `risk_layer_data` sang `district_data` theo `_id` (giữ `_id` cũ,
 * idempotent, thêm `kind`), rồi tạo chỉ mục. Không xóa/sửa collection cũ.
 * `dryRun` chỉ đọc và đếm. Bản ghi thiếu hoặc sai kiểu `district` vẫn được sao nguyên
 * và chỉ ghi cảnh báo. Dòng xung đột (cùng `_id` khác kind ở đích hoặc trùng giữa hai nguồn) không được ghi, chỉ báo vào `errors` (không checkpoint); các dòng còn lại vẫn được sao.
 * Sau khi ghi, mọi `_id` nguồn phải có mặt ở đích đúng `kind`, lệch thì ném lỗi.
 */
export async function migrateDistrictData(
  database: DistrictDataMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<DistrictDataMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(DISTRICT_DATA_COLLECTION)
  const plan: Array<{
    source: DistrictDataSource
    legacy: Doc
    exists: boolean
  }> = []
  const expectedByKind: Record<DistrictDataKindName, unknown[]> = {
    'area-profile': [],
    'risk-layer': [],
  }
  const seenIds = new Map<string, DistrictDataKindName>()

  for (const source of DISTRICT_DATA_SOURCES) {
    const legacyDocs = await database
      .collection(source.collection)
      .find()
      .toArray()
    report.counts[source.kind].source = legacyDocs.length
    for (const legacy of legacyDocs) {
      report.scanned += 1
      const label = `${source.collection}:${String(legacy._id)}`
      if (typeof legacy.district !== 'string') {
        report.warnings.push(
          `${label} thiếu hoặc sai kiểu district: giữ nguyên giá trị gốc`
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
        { $setOnInsert: toDistrictDataDoc(item.source, item.legacy) },
        { upsert: true }
      )
    }
  }

  for (const source of DISTRICT_DATA_SOURCES) {
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
          `${DISTRICT_DATA_MERGE_MIGRATION_ID}: count mismatch for kind ${source.kind} ` +
            `(expected ${expectedIds.length}, found ${found})`
        )
      }
    }
  }

  if (!dryRun) {
    for (const index of DISTRICT_DATA_INDEXES) {
      await target.createIndex(index.keys, { name: index.name })
    }
  }

  return report
}

/**
 * Rollback (dry-run mặc định), theo từng kind:
 * 1. `_id` có ở cả hai bên: `replaceOne` bản cũ bằng bản ở đích (bỏ `kind`),
 *    để trạng thái đổi sau khi chuyển code không bị mất;
 * 2. `_id` chỉ có ở đích (tạo sau khi chuyển code): chèn vào collection cũ;
 * 3. chỉ khi collection cũ chứa đủ các `_id` của kind đó mới xóa kind đó khỏi
 *    `district_data` (lệch thì báo lỗi, giữ nguyên kind);
 * 4. bỏ chỉ mục (chỉ khi không có lỗi).
 * Bản ghi chỉ có ở collection cũ (không có ở đích) được giữ nguyên, tính vào `skipped`.
 * `updated` = số bản ghi bị xóa khỏi đích (hoặc sẽ bị xóa khi dry-run);
 * `restored` = số bản ghi ghi ngược về collection cũ.
 */
export async function rollbackDistrictData(
  database: DistrictDataMongoDatabase,
  options: MigrationOptions = { dryRun: true }
): Promise<DistrictDataMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = database.collection(DISTRICT_DATA_COLLECTION)

  for (const source of DISTRICT_DATA_SOURCES) {
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
      const legacyDoc = fromDistrictDataDoc(row)
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
          `${DISTRICT_DATA_COLLECTION} kind=${source.kind} kept`
      )
      report.updated -= rows.length
      report.restored -= rows.length - have
      continue
    }
    await target.deleteMany({ kind: source.kind })
  }

  for (const source of DISTRICT_DATA_SOURCES) {
    report.counts[source.kind].target = await target.countDocuments({
      kind: source.kind,
    })
  }

  if (!dryRun && report.errors.length === 0) {
    for (const index of DISTRICT_DATA_INDEXES) {
      try {
        await target.dropIndex(index.name)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
  }

  return report
}
