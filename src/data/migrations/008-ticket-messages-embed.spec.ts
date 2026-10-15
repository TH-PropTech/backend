/* eslint-disable @typescript-eslint/explicit-function-return-type -- in-memory Mongo fakes */
import { ObjectId } from 'mongodb'
import {
  migrateTicketMessagesToEmbedded,
  rollbackTicketMessagesEmbedding,
  TICKET_MESSAGES_LIMIT,
  type MigrationCollection,
  type TicketMessagesMigrationDb,
} from './008-ticket-messages-embed'

type Doc = Record<string, unknown>

function get(doc: Doc, path: string): unknown[] {
  let values: unknown[] = [doc]
  for (const part of path.split('.')) {
    values = values.flatMap(v => {
      if (Array.isArray(v)) return v.map(x => (x as Doc)?.[part])
      return [(v as Doc | undefined)?.[part]]
    })
  }
  return values
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const values = get(doc, key)
    if (cond && typeof cond === 'object' && !(cond instanceof ObjectId)) {
      const c = cond as Doc
      if ('$in' in c)
        return values.some(v =>
          (c.$in as unknown[]).some(x => String(x) === String(v))
        )
      if ('$nin' in c)
        return !values.some(v =>
          (c.$nin as unknown[]).some(x => String(x) === String(v))
        )
      if ('$exists' in c)
        return values.some(v => v !== undefined) === (c.$exists as boolean)
    }
    return values.some(v => String(v) === String(cond))
  })
}

function fakeCollection(docs: Doc[]): MigrationCollection & { docs: Doc[] } {
  return {
    docs,
    find: (filter = {}, options = {}) => ({
      toArray: () => {
        const rows = docs.filter(d => matches(d, filter))
        const sort = options.sort ?? {}
        rows.sort((a, b) => {
          for (const [k, dir] of Object.entries(sort)) {
            const av = a[k] instanceof Date ? a[k].getTime() : String(a[k])
            const bv = b[k] instanceof Date ? b[k].getTime() : String(b[k])
            if (av < bv) return -dir
            if (av > bv) return dir
          }
          return 0
        })
        return Promise.resolve(rows)
      },
    }),
    distinct: key => Promise.resolve([...new Set(docs.map(d => d[key]))]),
    countDocuments: (filter = {}) =>
      Promise.resolve(docs.filter(d => matches(d, filter)).length),
    insertOne: doc => {
      docs.push({ ...doc })
      return Promise.resolve({})
    },
    updateOne: (filter, update) => {
      const target = docs.find(d => matches(d, filter))
      if (!target) return Promise.resolve({ matchedCount: 0, modifiedCount: 0 })
      const push = update.$push as { messages?: { $each: Doc[] } } | undefined
      if (push?.messages) {
        const list = (target.messages as Doc[] | undefined) ?? []
        list.push(...push.messages.$each)
        list.sort(
          (a, b) =>
            (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()
        )
        target.messages = list
      }
      if (update.$unset) {
        for (const k of Object.keys(update.$unset)) delete target[k]
      }
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
    },
  }
}

function setup(
  tickets: Doc[],
  messages: Doc[]
): {
  db: TicketMessagesMigrationDb
  tickets: ReturnType<typeof fakeCollection>
  messages: ReturnType<typeof fakeCollection>
} {
  const t = fakeCollection(tickets)
  const m = fakeCollection(messages)
  return {
    db: { collection: name => (name === 'support_tickets' ? t : m) },
    tickets: t,
    messages: m,
  }
}

function msg(
  ticketId: ObjectId | string,
  minute: number,
  extra: Doc = {}
): Doc {
  return {
    _id: new ObjectId(),
    ticketId: String(ticketId),
    senderId: 's',
    senderRole: 'staff',
    content: `m${minute}`,
    attachmentUrls: [],
    isInternal: false,
    createdAt: new Date(2026, 7, 1, 0, minute),
    ...extra,
  }
}

describe('008 ticket messages embed migration (G-TKT)', () => {
  it('is a dry run by default and writes nothing', async () => {
    const id = new ObjectId()
    const { db, tickets } = setup([{ _id: id }], [msg(id, 1), msg(id, 2)])

    const report = await migrateTicketMessagesToEmbedded(db)

    expect(report).toMatchObject({
      dryRun: true,
      scanned: 1,
      updated: 1,
      sourceMessages: 2,
      errors: [],
    })
    expect(tickets.docs[0]).not.toHaveProperty('messages')
  })

  it('applies, keeps _id and createdAt order, and is idempotent', async () => {
    const id = new ObjectId()
    const late = msg(id, 5)
    const early = msg(id, 1, { isInternal: true })
    const { db, tickets, messages } = setup([{ _id: id }], [late, early])

    const first = await migrateTicketMessagesToEmbedded(db, { dryRun: false })
    const second = await migrateTicketMessagesToEmbedded(db, { dryRun: false })

    expect(first).toMatchObject({ updated: 1, embeddedMessages: 2, errors: [] })
    const embedded = tickets.docs[0]?.messages as Doc[]
    expect(embedded.map(m => m._id)).toEqual([early._id, late._id])
    expect(embedded[0]).not.toHaveProperty('ticketId')
    expect(embedded[0]).toMatchObject({ isInternal: true, content: 'm1' })
    expect(second).toMatchObject({ updated: 0, skipped: 1, errors: [] })
    expect(embedded).toHaveLength(2)
    expect(messages.docs).toHaveLength(2)
  })

  it('reports orphan messages and oversized tickets without truncating', async () => {
    const big = new ObjectId()
    const ok = new ObjectId()
    const orphanTicket = new ObjectId()
    const bigMessages = Array.from(
      { length: TICKET_MESSAGES_LIMIT + 1 },
      (_, i) => msg(big, i)
    )
    const { db, tickets } = setup(
      [{ _id: big }, { _id: ok }],
      [...bigMessages, msg(ok, 1), msg(orphanTicket, 1)]
    )

    const report = await migrateTicketMessagesToEmbedded(db, { dryRun: false })

    expect(report.oversizedTicketIds).toEqual([String(big)])
    expect(report.errors).toHaveLength(1)
    expect(tickets.docs[0]).not.toHaveProperty('messages')
    expect((tickets.docs[1]?.messages as Doc[]).length).toBe(1)
    expect(report.orphanTicketIds).toEqual([String(orphanTicket)])
    expect(report.orphanMessages).toBe(1)
  })

  it('rolls back by restoring missing messages then removing messages[]', async () => {
    const id = new ObjectId()
    const old = msg(id, 1)
    const native = msg(id, 2)
    delete native.ticketId
    const { db, tickets, messages } = setup(
      [{ _id: id, messages: [{ ...old, ticketId: undefined }, native] }],
      [old]
    )

    const dry = await rollbackTicketMessagesEmbedding(db)
    expect(dry.dryRun).toBe(true)
    expect(tickets.docs[0]).toHaveProperty('messages')

    const report = await rollbackTicketMessagesEmbedding(db, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(tickets.docs[0]).not.toHaveProperty('messages')
    expect(messages.docs).toHaveLength(2)
    expect(messages.docs[1]).toMatchObject({
      _id: native._id,
      ticketId: String(id),
    })
  })
})
