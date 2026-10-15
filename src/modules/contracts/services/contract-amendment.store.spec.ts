import { ConflictException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { ContractAmendmentStore } from './contract-amendment.store'
import { MAX_CONTRACT_AMENDMENTS } from '../schemas/contract.schema'

type Doc = Record<string, unknown>

function one<T>(list: readonly T[]): T {
  const [first] = list
  if (first === undefined) throw new Error('expected at least one element')
  return first
}

const eq = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof ObjectId || b instanceof ObjectId)
    return String(a) === String(b)
  return a === b
}

/** Đánh giá điều kiện kiểu Mongo cho đủ dùng trong spec này. */
function matchValue(actual: unknown, cond: unknown): boolean {
  if (
    cond &&
    typeof cond === 'object' &&
    !(cond instanceof ObjectId) &&
    !(cond instanceof Date)
  ) {
    const op = cond as Doc
    if ('$ne' in op) return !eq(actual, op.$ne)
    if ('$in' in op) return (op.$in as unknown[]).some(x => eq(actual, x))
    if ('$exists' in op) return (actual !== undefined) === op.$exists
    if ('$elemMatch' in op) {
      return (
        Array.isArray(actual) &&
        actual.some(el => matchDoc(el as Doc, op.$elemMatch as Doc))
      )
    }
    if ('$not' in op) return !matchValue(actual, op.$not)
  }
  if (Array.isArray(actual)) return actual.some(x => eq(x, cond))
  return eq(actual, cond)
}

function matchDoc(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (!key.includes('.')) return matchValue(doc[key], cond)
    const [head = '', ...rest] = key.split('.')
    const sub = rest.join('.')
    const arr = doc[head]
    if (!Array.isArray(arr)) return matchValue(undefined, cond)
    if (cond && typeof cond === 'object' && '$ne' in (cond as Doc)) {
      return arr.every(el => matchValue((el as Doc)[sub], cond))
    }
    if (cond && typeof cond === 'object' && '$exists' in (cond as Doc)) {
      const index = Number(rest[0] ?? 0)
      const hit = arr.length > index && arr[index] !== undefined
      return hit === (cond as Doc).$exists
    }
    return arr.some(el => matchValue((el as Doc)[sub], cond))
  })
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) {
    return (value as unknown[]).map(v => clone(v)) as unknown as T
  }
  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof ObjectId) &&
    !(value instanceof Date)
  ) {
    const out: Doc = {}
    for (const [k, v] of Object.entries(value as Doc)) out[k] = clone(v)
    return out as T
  }
  return value
}

type FakeContracts = {
  rows: Doc[]
  writes: string[]
  aggregate: (pipeline: Doc[]) => { toArray: () => Promise<Doc[]> }
  updateOne: (
    filter: Doc,
    update: Doc
  ) => Promise<{ matchedCount: number; modifiedCount: number }>
}

function fakeContracts(rows: Doc[]): FakeContracts {
  const writes: string[] = []
  return {
    rows,
    writes,
    aggregate: (pipeline: Doc[]): { toArray: () => Promise<Doc[]> } => {
      const match = (pipeline[0] as { $match: Doc }).$match
      const docs = rows.filter(r => matchDoc(r, match))
      return {
        toArray: () =>
          Promise.resolve(
            docs.map(d => ({ _id: d._id, amendments: clone(d.amendments) }))
          ),
      }
    },
    updateOne: (
      filter: Doc,
      update: Doc
    ): Promise<{ matchedCount: number; modifiedCount: number }> => {
      const target = rows.find(r => matchDoc(r, filter))
      if (!target) return Promise.resolve({ matchedCount: 0, modifiedCount: 0 })
      writes.push(Object.keys(update).join(','))
      if (update.$push) {
        const [field, value] = Object.entries(update.$push as Doc)[0] ?? [
          '',
          null,
        ]
        const current = (target[field] as Doc[] | undefined) ?? []
        target[field] = [...current, clone(value)]
      }
      if (update.$set) {
        for (const [path, value] of Object.entries(update.$set as Doc)) {
          const m = /^amendments\.\$\.(.+)$/.exec(path)
          if (!m) continue
          const field = m[1] ?? ''
          const list = (target.amendments as Doc[] | undefined) ?? []
          const id = filter['amendments._id'] as ObjectId
          const element = list.find(el => matchDoc(el, { _id: id }))
          if (element) element[field] = clone(value)
        }
      }
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
    },
  }
}

const contractOid = new ObjectId('507f1f77bcf86cd799439011')
const otherOid = new ObjectId('507f1f77bcf86cd799439022')

function element(overrides: Doc = {}): Doc {
  return {
    _id: new ObjectId(),
    sequence: 1,
    status: 'effective',
    revision: 1,
    changes: [],
    beforeSnapshot: { monthlyRent: 100 },
    afterSnapshot: { monthlyRent: 120 },
    effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
    contentHash: 'h'.repeat(8),
    idempotencyKey: null,
    ledgerStatus: 'pending',
    ...overrides,
  }
}

function setup(contracts: Doc[]): {
  store: ContractAmendmentStore
  contracts$: FakeContracts
} {
  const contractsRepo = fakeContracts(contracts)
  const store = new ContractAmendmentStore(contractsRepo as never)
  return { store, contracts$: contractsRepo }
}

describe('ContractAmendmentStore', () => {
  it('reads by contract, maps contractId onto each element and keeps the element _id', async () => {
    const e1 = element({ sequence: 1 })
    const { store } = setup([{ _id: contractOid, amendments: [e1] }])

    const items = await store.find({
      where: { contractId: contractOid.toHexString() },
    })

    expect(items).toHaveLength(1)
    const item = one(items)
    expect(item.contractId).toBe(contractOid.toHexString())
    expect(String(item._id)).toBe(String(e1._id))
  })

  it('finds an amendment by _id across contracts without knowing the parent', async () => {
    const e = element()
    const { store } = setup([
      { _id: otherOid, amendments: [element({ sequence: 9 })] },
      { _id: contractOid, amendments: [e] },
    ])

    const found = await store.findOne({ where: { _id: e._id } })

    expect(found?.contractId).toBe(contractOid.toHexString())
  })

  it('drops snapshots when listing with omitSnapshots', async () => {
    const { store } = setup([{ _id: contractOid, amendments: [element()] }])

    const item = one(
      await store.find({
        where: { contractId: contractOid.toHexString() },
        omitSnapshots: true,
      })
    )

    expect(item).not.toHaveProperty('beforeSnapshot')
    expect(item).not.toHaveProperty('afterSnapshot')
    expect(item.contentHash).toBeDefined()
  })

  it('finds effective amendments across all contracts (dirty data: other statuses and empty arrays ignored)', async () => {
    const eff = element({ status: 'effective' })
    const { store } = setup([
      { _id: contractOid, amendments: [element({ status: 'draft' }), eff] },
      { _id: otherOid, amendments: [element({ status: 'superseded' })] },
      { _id: new ObjectId(), amendments: undefined },
    ])

    const items = await store.find({ where: { status: 'effective' } })

    expect(items.map(i => String(i._id))).toEqual([String(eff._id)])
  })

  it('sorts by sequence', async () => {
    const { store } = setup([
      {
        _id: contractOid,
        amendments: [
          element({ sequence: 3 }),
          element({ sequence: 1 }),
          element({ sequence: 2 }),
        ],
      },
    ])

    const items = await store.find({
      where: { contractId: contractOid.toHexString() },
      order: { sequence: 'DESC' },
    })

    expect(items.map(i => i.sequence)).toEqual([3, 2, 1])
  })

  it('updates only changed fields of one element with a positional $set and leaves siblings intact', async () => {
    const a = element({ sequence: 1 })
    const b = element({ sequence: 2, status: 'draft' })
    const { store, contracts$ } = setup([
      { _id: contractOid, amendments: [a, b] },
    ])
    const loaded = one(await store.find({ where: { _id: b._id } }))

    loaded.ledgerStatus = 'confirmed'
    loaded.ledgerTxHash = '0xabc'
    await store.save(loaded)

    const stored = one(contracts$.rows).amendments as Doc[]
    expect(stored[1]?.ledgerStatus).toBe('confirmed')
    expect(stored[1]?.ledgerTxHash).toBe('0xabc')
    expect(stored[1]?.status).toBe('draft')
    expect(stored[0]).toEqual(a)
    expect(contracts$.writes).toHaveLength(1)
  })

  it('does not write when nothing changed on a loaded amendment', async () => {
    const { store, contracts$ } = setup([
      { _id: contractOid, amendments: [element()] },
    ])
    const loaded = one(
      await store.find({ where: { contractId: contractOid.toHexString() } })
    )

    await store.save(loaded)

    expect(contracts$.writes).toHaveLength(0)
  })

  it('inserts a new amendment with $push and keeps the existing array', async () => {
    const existing = element({ sequence: 1, status: 'effective' })
    const { store, contracts$ } = setup([
      { _id: contractOid, amendments: [existing] },
    ])

    const created = store.create({
      contractId: contractOid.toHexString(),
      sequence: 2,
      status: 'draft',
      revision: 0,
      idempotencyKey: 'key-2',
    })
    await store.save(created)

    const stored = one(contracts$.rows).amendments as Doc[]
    expect(stored.map(s => s.sequence)).toEqual([1, 2])
    expect(String(stored[1]?._id)).toBe(created._id.toHexString())
    expect(stored[1]).not.toHaveProperty('contractId')
    expect(created.createdAt).toBeInstanceOf(Date)
  })

  it('refuses a second open amendment (atomic guard, not only the read check)', async () => {
    const { store, contracts$ } = setup([
      {
        _id: contractOid,
        amendments: [element({ sequence: 1, status: 'locked' })],
      },
    ])
    const created = store.create({
      contractId: contractOid.toHexString(),
      sequence: 2,
      status: 'draft',
    })

    await expect(store.save(created)).rejects.toBeInstanceOf(ConflictException)
    await expect(store.save(created)).rejects.toThrow(
      'CONTRACT_AMENDMENT_IN_PROGRESS'
    )
    expect(one(contracts$.rows).amendments as Doc[]).toHaveLength(1)
  })

  it('refuses a duplicate sequence in the embedded array', async () => {
    const { store } = setup([
      {
        _id: contractOid,
        amendments: [element({ sequence: 1, status: 'rejected' })],
      },
    ])
    const created = store.create({
      contractId: contractOid.toHexString(),
      sequence: 1,
      status: 'draft',
    })

    await expect(store.save(created)).rejects.toThrow(
      'CONTRACT_AMENDMENT_SEQUENCE_CONFLICT'
    )
  })

  it('refuses a duplicate idempotencyKey in the embedded array', async () => {
    const { store } = setup([
      {
        _id: contractOid,
        amendments: [
          element({ sequence: 1, status: 'rejected', idempotencyKey: 'dup' }),
        ],
      },
    ])
    const created = store.create({
      contractId: contractOid.toHexString(),
      sequence: 2,
      status: 'rejected',
      idempotencyKey: 'dup',
    })

    await expect(store.save(created)).rejects.toThrow(
      'CONTRACT_AMENDMENT_SEQUENCE_CONFLICT'
    )
  })

  it('enforces the cap: at MAX amendments a new one returns 409 and nothing is cut', async () => {
    const full = Array.from({ length: MAX_CONTRACT_AMENDMENTS }, (_, i) =>
      element({ sequence: i + 1, status: 'rejected' })
    )
    const { store, contracts$ } = setup([
      { _id: contractOid, amendments: full },
    ])
    const created = store.create({
      contractId: contractOid.toHexString(),
      sequence: MAX_CONTRACT_AMENDMENTS + 1,
      status: 'rejected',
    })

    await expect(store.save(created)).rejects.toThrow(
      'CONTRACT_AMENDMENT_LIMIT_REACHED'
    )
    expect(one(contracts$.rows).amendments as Doc[]).toHaveLength(
      MAX_CONTRACT_AMENDMENTS
    )
  })

  it('throws NotFound when updating an amendment that is no longer embedded', async () => {
    const { store } = setup([{ _id: contractOid, amendments: [element()] }])
    const loaded = one(
      await store.find({ where: { contractId: contractOid.toHexString() } })
    )
    loaded.status = 'cancelled'
    ;(loaded as unknown as { _id: ObjectId })._id = new ObjectId()

    await expect(store.save(loaded)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rejects an invalid contract id without touching the database', async () => {
    const { store, contracts$ } = setup([])
    const created = store.create({
      contractId: 'not-an-id',
      sequence: 1,
      status: 'draft',
    })

    await expect(store.save(created)).rejects.toBeInstanceOf(NotFoundException)
    expect(contracts$.writes).toHaveLength(0)
  })
})
