/* eslint-disable @typescript-eslint/explicit-function-return-type -- in-memory Mongo fakes */
import { ObjectId } from 'mongodb'
import {
  MAINTENANCE_TICKETS_LIMIT,
  migrateMaintenanceTicketsToEmbedded,
  rollbackMaintenanceTicketsEmbedding,
  type MaintenanceMigrationCollection,
  type MaintenanceMigrationDb,
} from './012-maintenance-tickets-embed'

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

function fakeCollection(
  docs: Doc[]
): MaintenanceMigrationCollection & { docs: Doc[]; writes: number } {
  const col = {
    docs,
    writes: 0,
    find: (filter: Doc = {}) => ({
      toArray: () => Promise.resolve(docs.filter(d => matches(d, filter))),
    }),
    insertOne: (doc: Doc) => {
      col.writes += 1
      docs.push({ ...doc })
      return Promise.resolve({})
    },
    updateOne: (filter: Doc, update: Doc) => {
      const target = docs.find(d => matches(d, filter))
      if (!target) return Promise.resolve({ matchedCount: 0, modifiedCount: 0 })
      col.writes += 1
      const push = update.$push as
        | { maintenanceTickets?: { $each: Doc[] } }
        | undefined
      if (push?.maintenanceTickets) {
        const list = (target.maintenanceTickets as Doc[] | undefined) ?? []
        list.push(...push.maintenanceTickets.$each)
        target.maintenanceTickets = list
      }
      if (update.$set) Object.assign(target, update.$set)
      if (update.$unset) {
        for (const k of Object.keys(update.$unset)) delete target[k]
      }
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
    },
  }
  return col
}

function setup(apartments: Doc[], tickets: Doc[]) {
  const a = fakeCollection(apartments)
  const t = fakeCollection(tickets)
  const db: MaintenanceMigrationDb = {
    collection: name => (name === 'apartments' ? a : t),
  }
  return { db, apartments: a, tickets: t }
}

const aptId = new ObjectId()
const otherAptId = new ObjectId()

function ticket(propertyId: unknown, minute: number, extra: Doc = {}): Doc {
  return {
    _id: new ObjectId(),
    propertyId,
    propertyTitle: 'Căn A',
    tenantId: 'u1',
    description: `d${minute}`,
    images: ['a.jpg'],
    status: 'pending',
    resolvedAt: null,
    createdAt: new Date(2026, 0, 1, 0, minute),
    updatedAt: new Date(2026, 0, 1, 0, minute),
    ...extra,
  }
}

describe('012-maintenance-tickets-embed', () => {
  it('dry-run reports but writes nothing', async () => {
    const t1 = ticket(String(aptId), 1)
    const { db, apartments } = setup([{ _id: aptId }], [t1])

    const report = await migrateMaintenanceTicketsToEmbedded(db)

    expect(report).toMatchObject({
      dryRun: true,
      sourceTickets: 1,
      updated: 1,
      errors: [],
    })
    expect(apartments.writes).toBe(0)
    expect(apartments.docs[0]?.maintenanceTickets).toBeUndefined()
  })

  it('embeds tickets by $push, keeps _id and is idempotent', async () => {
    const t1 = ticket(String(aptId), 2)
    const t2 = ticket(String(aptId), 1)
    const t3 = ticket(String(otherAptId), 3)
    const { db, apartments, tickets } = setup(
      [{ _id: aptId }, { _id: otherAptId }],
      [t1, t2, t3]
    )

    const first = await migrateMaintenanceTicketsToEmbedded(db, {
      dryRun: false,
    })

    expect(first).toMatchObject({
      updated: 3,
      embeddedTickets: 3,
      errors: [],
      orphanTicketIds: [],
    })
    const embedded = apartments.docs[0]?.maintenanceTickets as Doc[]
    expect(embedded.map(e => String(e._id))).toEqual([
      String(t1._id),
      String(t2._id),
    ])
    expect(embedded[0]).not.toHaveProperty('propertyId')
    expect(tickets.docs).toHaveLength(3)

    const writes = apartments.writes
    const second = await migrateMaintenanceTicketsToEmbedded(db, {
      dryRun: false,
    })
    expect(second).toMatchObject({ updated: 0, skipped: 3, errors: [] })
    expect(apartments.writes).toBe(writes)
  })

  it('writes nothing and reports orphans when propertyId is not an apartment id', async () => {
    const good = ticket(String(aptId), 1)
    const orphanA = ticket('not-an-id', 2)
    const orphanB = ticket(String(new ObjectId()), 3)
    const { db, apartments } = setup([{ _id: aptId }], [good, orphanA, orphanB])

    const report = await migrateMaintenanceTicketsToEmbedded(db, {
      dryRun: false,
    })

    expect(report.orphanTicketIds).toEqual([
      String(orphanA._id),
      String(orphanB._id),
    ])
    expect(report.errors).toHaveLength(1)
    expect(apartments.writes).toBe(0)
  })

  it('reports (does not truncate) apartments over the ticket or image cap', async () => {
    const many = Array.from({ length: MAINTENANCE_TICKETS_LIMIT + 1 }, (_, i) =>
      ticket(String(aptId), i)
    )
    const images = ticket(String(otherAptId), 1, {
      images: Array.from({ length: 21 }, (_, i) => `${i}.jpg`),
    })
    const { db, apartments } = setup(
      [{ _id: aptId }, { _id: otherAptId }],
      [...many, images]
    )

    const report = await migrateMaintenanceTicketsToEmbedded(db, {
      dryRun: false,
    })

    expect(report.oversizedApartmentIds).toEqual([
      String(aptId),
      String(otherAptId),
    ])
    expect(report.errors).toHaveLength(2)
    expect(apartments.writes).toBe(0)
  })

  it('rolls back including tickets written and states changed after the code switch', async () => {
    const t1 = ticket(String(aptId), 1)
    const { db, apartments, tickets } = setup([{ _id: aptId }], [t1])
    await migrateMaintenanceTicketsToEmbedded(db, { dryRun: false })

    // Sau khi chuyển code: phiếu mới và đổi trạng thái phiếu cũ.
    const fresh = {
      _id: new ObjectId(),
      tenantId: 'u2',
      description: 'new',
      images: [],
      status: 'pending',
      resolvedAt: null,
      createdAt: new Date(2026, 0, 2),
      updatedAt: new Date(2026, 0, 2),
    }
    const list = apartments.docs[0]?.maintenanceTickets as Doc[]
    list[0] = {
      ...list[0],
      status: 'resolved',
      resolvedAt: new Date(2026, 1, 1),
    }
    list.push(fresh)

    const dry = await rollbackMaintenanceTicketsEmbedding(db)
    expect(dry).toMatchObject({ dryRun: true, restored: 1 })
    expect(tickets.docs).toHaveLength(1)

    const report = await rollbackMaintenanceTicketsEmbedding(db, {
      dryRun: false,
    })

    expect(report).toMatchObject({ restored: 1, errors: [] })
    expect(tickets.docs).toHaveLength(2)
    expect(tickets.docs.find(d => d._id === t1._id)).toMatchObject({
      status: 'resolved',
    })
    expect(tickets.docs.find(d => d._id === fresh._id)).toMatchObject({
      propertyId: String(aptId),
      description: 'new',
    })
    expect(apartments.docs[0]).not.toHaveProperty('maintenanceTickets')

    // Chạy lại: không còn mảng nên không làm gì.
    const again = await rollbackMaintenanceTicketsEmbedding(db, {
      dryRun: false,
    })
    expect(again).toMatchObject({ scanned: 0, restored: 0 })
  })
})
