import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-TKT: nhúng collection `ticket_messages` vào `support_tickets.messages[]`.
 *
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - Idempotent: tin đã có trong `messages[]` (theo `_id`) bị bỏ qua; `_id` cũ được giữ.
 * - Kiểm đếm sau khi áp dụng: mỗi ticket phải chứa đủ `_id` nguồn, lệch thì lỗi và dừng.
 * - Không xóa `ticket_messages`. Ticket quá `MAX_TICKET_MESSAGES` tin và tin mồ côi
 *   chỉ được báo cáo (không tự cắt, không tự xóa).
 * - `rollbackTicketMessagesEmbedding` chép ngược tin thiếu về `ticket_messages`
 *   rồi mới bỏ `messages` khỏi ticket.
 */
export const TICKET_MESSAGES_EMBED_MIGRATION_ID = '008-ticket-messages-embed'

/** Trần cứng tin nhắn/ticket (khớp `MAX_TICKET_MESSAGES` của schema). */
export const TICKET_MESSAGES_LIMIT = 500

type Doc = Record<string, unknown>

export interface MigrationCollection {
  find(
    filter?: Doc,
    options?: { sort?: Record<string, 1 | -1>; projection?: Doc }
  ): { toArray(): Promise<Doc[]> }
  distinct(key: string): Promise<unknown[]>
  countDocuments(filter?: Doc): Promise<number>
  insertOne(doc: Doc): Promise<unknown>
  updateOne(
    filter: Doc,
    update: Doc
  ): Promise<{ matchedCount: number; modifiedCount: number }>
}

export interface TicketMessagesMigrationDb {
  collection(name: string): MigrationCollection
}

export type TicketMessagesMigrationReport = MigrationReport & {
  sourceMessages: number
  embeddedMessages: number
  orphanMessages: number
  orphanTicketIds: string[]
  oversizedTicketIds: string[]
}

function newReport(dryRun: boolean): TicketMessagesMigrationReport {
  return {
    migrationId: TICKET_MESSAGES_EMBED_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    sourceMessages: 0,
    embeddedMessages: 0,
    orphanMessages: 0,
    orphanTicketIds: [],
    oversizedTicketIds: [],
  }
}

function time(value: unknown): number {
  return value instanceof Date
    ? value.getTime()
    : new Date(String(value)).getTime()
}

function toEntry(message: Doc): Doc {
  return {
    _id: message._id,
    senderId: message.senderId,
    senderRole: message.senderRole,
    content: message.content,
    attachmentUrls: Array.isArray(message.attachmentUrls)
      ? message.attachmentUrls
      : [],
    isInternal: message.isInternal ?? false,
    createdAt: message.createdAt,
  }
}

function idsOf(entries: unknown): Set<string> {
  const set = new Set<string>()
  if (Array.isArray(entries)) {
    for (const entry of entries as Doc[]) set.add(String(entry._id))
  }
  return set
}

export async function migrateTicketMessagesToEmbedded(
  db: TicketMessagesMigrationDb,
  options: MigrationOptions = {}
): Promise<TicketMessagesMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const tickets = db.collection('support_tickets')
  const messages = db.collection('ticket_messages')

  const allTickets = await tickets.find({}).toArray()
  const ticketIds = new Set(allTickets.map(t => String(t._id)))

  for (const ticket of allTickets) {
    report.scanned += 1
    const ticketId = String(ticket._id)
    const source = await messages
      .find({ ticketId }, { sort: { createdAt: 1, _id: 1 } })
      .toArray()
    report.sourceMessages += source.length
    const existing = idsOf(ticket.messages)
    const missing = source.filter(m => !existing.has(String(m._id)))

    if (missing.length === 0) {
      report.skipped += 1
      report.embeddedMessages += source.length
      continue
    }
    if (existing.size + missing.length > TICKET_MESSAGES_LIMIT) {
      report.skipped += 1
      report.oversizedTicketIds.push(ticketId)
      report.errors.push(
        `ticket ${ticketId}: ${existing.size + missing.length} messages exceed the ${TICKET_MESSAGES_LIMIT} cap; not migrated`
      )
      continue
    }

    report.updated += 1
    report.embeddedMessages += source.length
    if (dryRun) continue

    const missingIds = missing.map(m => m._id)
    await tickets.updateOne(
      { _id: ticket._id, 'messages._id': { $nin: missingIds } },
      {
        $push: {
          messages: {
            $each: missing.map(toEntry),
            $sort: { createdAt: 1 },
          },
        },
      }
    )

    // Kiểm đếm: ticket phải chứa đủ _id nguồn.
    const [after] = await tickets.find({ _id: ticket._id }).toArray()
    const embedded = idsOf(after?.messages)
    const lacking = source.filter(m => !embedded.has(String(m._id)))
    if (lacking.length > 0) {
      report.errors.push(
        `ticket ${ticketId}: ${lacking.length}/${source.length} messages missing after apply; stopped`
      )
      return report
    }
  }

  const sourceTicketIds = (await messages.distinct('ticketId')).map(String)
  report.orphanTicketIds = sourceTicketIds.filter(id => !ticketIds.has(id))
  if (report.orphanTicketIds.length > 0) {
    report.orphanMessages = await messages.countDocuments({
      ticketId: { $in: report.orphanTicketIds },
    })
  }

  return report
}

export async function rollbackTicketMessagesEmbedding(
  db: TicketMessagesMigrationDb,
  options: MigrationOptions = {}
): Promise<TicketMessagesMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const tickets = db.collection('support_tickets')
  const messages = db.collection('ticket_messages')

  const withMessages = await tickets
    .find({ messages: { $exists: true } })
    .toArray()

  for (const ticket of withMessages) {
    report.scanned += 1
    const ticketId = String(ticket._id)
    const embedded = (
      Array.isArray(ticket.messages) ? ticket.messages : []
    ) as Doc[]
    report.embeddedMessages += embedded.length

    const legacy = await messages.find({ ticketId }).toArray()
    const legacyIds = idsOf(legacy)
    const toRestore = embedded.filter(m => !legacyIds.has(String(m._id)))
    report.sourceMessages += legacy.length + toRestore.length

    if (dryRun) {
      report.updated += 1
      continue
    }

    for (const entry of [...toRestore].sort(
      (a, b) => time(a.createdAt) - time(b.createdAt)
    )) {
      await messages.insertOne({ ...entry, ticketId })
    }

    // Chỉ bỏ `messages` khi ticket_messages đã chứa đủ.
    const restored = idsOf(await messages.find({ ticketId }).toArray())
    const lacking = embedded.filter(m => !restored.has(String(m._id)))
    if (lacking.length > 0) {
      report.errors.push(
        `ticket ${ticketId}: ${lacking.length} messages not restored; messages[] kept; stopped`
      )
      return report
    }
    await tickets.updateOne({ _id: ticket._id }, { $unset: { messages: '' } })
    report.updated += 1
  }

  return report
}
