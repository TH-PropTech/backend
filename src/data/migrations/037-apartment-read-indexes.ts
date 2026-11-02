import { safeDropIndex } from './migration.mongo-helpers'
import type { MigrationOptions, MigrationReport } from './migration.types'

export const APARTMENT_READ_INDEXES_MIGRATION_ID = '037-apartment-read-indexes'

type IndexKeys = Record<string, 1 | -1>

/**
 * Chỉ mục cho truy vấn đọc công khai của `apartments` (xem change backend-read-scaling-and-ec2-hardening).
 * `synchronize` tắt ở production nên entity không tự tạo chỉ mục; migration này là nguồn duy nhất.
 */
export const APARTMENT_READ_INDEXES: Array<{
  collection: string
  keys: IndexKeys
  options: { name: string }
}> = [
  {
    collection: 'apartments',
    keys: { status: 1, createdAt: -1 },
    options: { name: 'apartments_status_created_at' },
  },
  {
    collection: 'apartments',
    keys: { status: 1, city: 1, district: 1, priceMonthly: 1 },
    options: { name: 'apartments_status_city_district_price' },
  },
  {
    collection: 'apartments',
    keys: { landlordId: 1, createdAt: -1 },
    options: { name: 'apartments_landlord_created_at' },
  },
]

export interface ApartmentIndexCollection {
  createIndex(keys: IndexKeys, options: object): Promise<string>
  dropIndex(name: string): Promise<unknown>
}

export interface ApartmentIndexDatabase {
  collection(name: string): ApartmentIndexCollection
}

/**
 * Tạo chỉ mục đọc cho `apartments`. Tạo lại chỉ mục đã có (cùng khoá, cùng tên) là thao tác rỗng.
 * Dry-run không ghi gì và chỉ báo số chỉ mục sẽ tạo.
 */
export async function ensureApartmentReadIndexes(
  database: ApartmentIndexDatabase,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? true
  if (!dryRun) {
    for (const {
      collection,
      keys,
      options: indexOptions,
    } of APARTMENT_READ_INDEXES)
      await database.collection(collection).createIndex(keys, indexOptions)
  }
  return {
    migrationId: APARTMENT_READ_INDEXES_MIGRATION_ID,
    scanned: APARTMENT_READ_INDEXES.length,
    updated: dryRun ? 0 : APARTMENT_READ_INDEXES.length,
    skipped: dryRun ? APARTMENT_READ_INDEXES.length : 0,
    errors: [],
    dryRun,
  }
}

/** Chỉ xoá đúng các chỉ mục do migration này tạo; chỉ mục khác của `apartments` giữ nguyên. */
export async function rollbackApartmentReadIndexes(
  database: ApartmentIndexDatabase,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? true
  let dropped = 0
  if (!dryRun) {
    for (const {
      collection,
      options: indexOptions,
    } of APARTMENT_READ_INDEXES) {
      const done = await safeDropIndex(
        database.collection(collection),
        indexOptions.name
      )
      if (done) dropped += 1
    }
  }
  return {
    migrationId: APARTMENT_READ_INDEXES_MIGRATION_ID,
    scanned: APARTMENT_READ_INDEXES.length,
    updated: dropped,
    skipped: APARTMENT_READ_INDEXES.length - dropped,
    errors: [],
    dryRun,
  }
}
