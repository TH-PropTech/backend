import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-MNT: nhúng collection `maintenance_tickets` vào `apartments.maintenanceTickets[]`.
 *
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - `propertyId` của phiếu phải khớp `apartments._id`. Có phiếu mồ côi (không khớp
 *   căn hộ nào) thì KHÔNG ghi gì cả: báo lỗi và dừng (điều kiện survey G-MNT).
 * - Idempotent: phiếu đã có trong mảng (theo `_id`) bị bỏ qua; `_id` cũ được giữ.
 * - Ghi bằng `updateOne` + `$push` (không `save` căn hộ). Căn hộ quá trần phiếu/ảnh
 *   chỉ được báo cáo, không tự cắt.
 * - Kiểm đếm sau khi áp dụng: mỗi căn hộ phải chứa đủ `_id` nguồn, lệch thì lỗi và dừng.
 * - Không xóa `maintenance_tickets`.
 * - Rollback sao ngược kể cả phiếu ghi sau khi chuyển code (và trạng thái đã đổi)
 *   về `maintenance_tickets`, chỉ `$unset` mảng khi collection cũ đã chứa đủ.
 */
export const MAINTENANCE_TICKETS_EMBED_MIGRATION_ID =
  '012-maintenance-tickets-embed'

/** Trần cứng (khớp `MAX_MAINTENANCE_TICKETS` / `MAX_MAINTENANCE_TICKET_IMAGES` của schema). */
export const MAINTENANCE_TICKETS_LIMIT = 100
export const MAINTENANCE_TICKET_IMAGES_LIMIT = 20

type Doc = Record<string, unknown>

export interface MaintenanceMigrationCollection {
  find(filter?: Doc): { toArray(): Promise<Doc[]> }
  insertOne(doc: Doc): Promise<unknown>
  updateOne(
    filter: Doc,
    update: Doc
  ): Promise<{ matchedCount: number; modifiedCount: number }>
}

export interface MaintenanceMigrationDb {
  collection(name: string): MaintenanceMigrationCollection
}

export type MaintenanceTicketsMigrationReport = MigrationReport & {
  sourceTickets: number
  embeddedTickets: number
  orphanTicketIds: string[]
  oversizedApartmentIds: string[]
  /** Rollback: phiếu ghi sau khi chuyển code, được sao ngược về collection cũ. */
  restored: number
  /** Rollback: phiếu còn ở collection cũ nhưng không còn trong mảng nhúng (không đụng tới). */
  legacyOnly: number
}

function newReport(dryRun: boolean): MaintenanceTicketsMigrationReport {
  return {
    migrationId: MAINTENANCE_TICKETS_EMBED_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    sourceTickets: 0,
    embeddedTickets: 0,
    orphanTicketIds: [],
    oversizedApartmentIds: [],
    restored: 0,
    legacyOnly: 0,
  }
}

function idsOf(entries: unknown): Set<string> {
  const set = new Set<string>()
  if (Array.isArray(entries)) {
    for (const entry of entries as Doc[]) set.add(String(entry._id))
  }
  return set
}

function time(value: unknown): number {
  return value instanceof Date
    ? value.getTime()
    : new Date(String(value)).getTime()
}

function toEntry(ticket: Doc): Doc {
  const entry: Doc = {
    _id: ticket._id,
    tenantId: ticket.tenantId,
    description: ticket.description,
    images: Array.isArray(ticket.images) ? ticket.images : [],
    status: ticket.status ?? 'pending',
    resolvedAt: ticket.resolvedAt ?? null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  }
  if (ticket.propertyTitle !== undefined) {
    entry.propertyTitle = ticket.propertyTitle
  }
  return entry
}

/** Hình dạng collection cũ từ phần tử nhúng. */
function toLegacy(apartmentId: string, entry: Doc): Doc {
  const legacy: Doc = {
    _id: entry._id,
    propertyId: apartmentId,
    tenantId: entry.tenantId,
    description: entry.description,
    images: Array.isArray(entry.images) ? entry.images : [],
    status: entry.status,
    resolvedAt: entry.resolvedAt ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
  if (entry.propertyTitle !== undefined) {
    legacy.propertyTitle = entry.propertyTitle
  }
  return legacy
}

function apartmentKey(propertyId: unknown): string | null {
  if (typeof propertyId === 'string' && /^[0-9a-fA-F]{24}$/.test(propertyId)) {
    return propertyId.toLowerCase()
  }
  return null
}

export async function migrateMaintenanceTicketsToEmbedded(
  db: MaintenanceMigrationDb,
  options: MigrationOptions = {}
): Promise<MaintenanceTicketsMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const apartments = db.collection('apartments')
  const tickets = db.collection('maintenance_tickets')

  const source = await tickets.find({}).toArray()
  report.sourceTickets = source.length
  report.scanned = source.length

  const allApartments = await apartments.find({}).toArray()
  const byId = new Map(allApartments.map(a => [String(a._id), a]))

  // Gom phiếu theo căn hộ; phiếu không khớp căn hộ nào là mồ côi.
  const grouped = new Map<string, Doc[]>()
  for (const ticket of source) {
    const key = apartmentKey(ticket.propertyId)
    if (!key || !byId.has(key)) {
      report.orphanTicketIds.push(String(ticket._id))
      continue
    }
    const list = grouped.get(key) ?? []
    list.push(ticket)
    grouped.set(key, list)
  }
  if (report.orphanTicketIds.length > 0) {
    report.errors.push(
      `${report.orphanTicketIds.length} ticket(s) have a propertyId that is not an apartments._id; nothing migrated`
    )
    return report
  }

  for (const [key, group] of grouped) {
    const apartment = byId.get(key) as Doc
    const existing = idsOf(apartment.maintenanceTickets)
    const missing = group.filter(t => !existing.has(String(t._id)))

    if (missing.length === 0) {
      report.skipped += group.length
      report.embeddedTickets += group.length
      continue
    }
    if (existing.size + missing.length > MAINTENANCE_TICKETS_LIMIT) {
      report.skipped += group.length
      report.oversizedApartmentIds.push(key)
      report.errors.push(
        `apartment ${key}: ${existing.size + missing.length} tickets exceed the ${MAINTENANCE_TICKETS_LIMIT} cap; not migrated`
      )
      continue
    }
    const tooManyImages = missing.find(
      t =>
        Array.isArray(t.images) &&
        t.images.length > MAINTENANCE_TICKET_IMAGES_LIMIT
    )
    if (tooManyImages) {
      report.skipped += group.length
      report.oversizedApartmentIds.push(key)
      report.errors.push(
        `apartment ${key}: ticket ${String(tooManyImages._id)} has more than ${MAINTENANCE_TICKET_IMAGES_LIMIT} images; not migrated`
      )
      continue
    }

    report.skipped += group.length - missing.length
    report.updated += missing.length
    report.embeddedTickets += group.length
    if (dryRun) continue

    await apartments.updateOne(
      {
        _id: apartment._id,
        'maintenanceTickets._id': { $nin: missing.map(t => t._id) },
      },
      {
        $push: {
          maintenanceTickets: {
            $each: missing.map(toEntry),
            $sort: { createdAt: 1 },
          },
        },
      }
    )

    // Kiểm đếm: căn hộ phải chứa đủ `_id` nguồn.
    const [after] = await apartments.find({ _id: apartment._id }).toArray()
    const embedded = idsOf(after?.maintenanceTickets)
    const lacking = group.filter(t => !embedded.has(String(t._id)))
    if (lacking.length > 0) {
      report.errors.push(
        `apartment ${key}: ${lacking.length}/${group.length} tickets missing after apply; stopped`
      )
      return report
    }
  }

  return report
}

export async function rollbackMaintenanceTicketsEmbedding(
  db: MaintenanceMigrationDb,
  options: MigrationOptions = {}
): Promise<MaintenanceTicketsMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const apartments = db.collection('apartments')
  const tickets = db.collection('maintenance_tickets')

  const withTickets = await apartments
    .find({ maintenanceTickets: { $exists: true } })
    .toArray()
  const legacyAll = await tickets.find({}).toArray()
  const legacyById = new Map(legacyAll.map(t => [String(t._id), t]))
  report.sourceTickets = legacyAll.length
  const embeddedIds = new Set<string>()

  for (const apartment of withTickets) {
    report.scanned += 1
    const apartmentId = String(apartment._id)
    const embedded = (
      Array.isArray(apartment.maintenanceTickets)
        ? apartment.maintenanceTickets
        : []
    ) as Doc[]
    report.embeddedTickets += embedded.length
    for (const entry of embedded) embeddedIds.add(String(entry._id))

    const fresh = embedded.filter(e => !legacyById.has(String(e._id)))
    const existing = embedded.filter(e => legacyById.has(String(e._id)))
    report.restored += fresh.length
    report.updated += 1
    if (dryRun) continue

    for (const entry of [...fresh].sort(
      (a, b) => time(a.createdAt) - time(b.createdAt)
    )) {
      await tickets.insertOne(toLegacy(apartmentId, entry))
    }
    // Trạng thái đổi sau khi chuyển code: bản nhúng là bản mới nhất.
    for (const entry of existing) {
      const { _id, ...fields } = toLegacy(apartmentId, entry)
      await tickets.updateOne({ _id }, { $set: fields })
    }

    // Chỉ bỏ mảng khi `maintenance_tickets` đã chứa đủ.
    const restored = idsOf(
      await tickets.find({ propertyId: apartmentId }).toArray()
    )
    const lacking = embedded.filter(e => !restored.has(String(e._id)))
    if (lacking.length > 0) {
      report.errors.push(
        `apartment ${apartmentId}: ${lacking.length} tickets not restored; maintenanceTickets kept; stopped`
      )
      return report
    }
    await apartments.updateOne(
      { _id: apartment._id },
      { $unset: { maintenanceTickets: '' } }
    )
  }

  report.legacyOnly = legacyAll.filter(
    t => !embeddedIds.has(String(t._id))
  ).length
  return report
}
