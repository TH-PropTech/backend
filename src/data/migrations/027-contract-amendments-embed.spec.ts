import { ObjectId } from 'mongodb'
import { MAX_CONTRACT_AMENDMENTS } from '../../modules/contracts/schemas/contract.schema'
import {
  CONTRACT_AMENDMENTS_EMBED_MIGRATION_ID,
  migrateContractAmendmentsToEmbedded,
  rollbackContractAmendmentsEmbed,
  type ContractAmendmentsMigrationDb,
  type MigrationCollection,
} from './027-contract-amendments-embed'

type Doc = Record<string, unknown>

const isOp = (cond: unknown): cond is Doc =>
  !!cond && typeof cond === 'object' && !(cond instanceof ObjectId)

const eq = (a: unknown, b: unknown): boolean => String(a) === String(b)

/** Giá trị theo đường dẫn; mảng được duyệt từng phần tử (như Mongo). */
function valuesAt(doc: Doc, path: string): unknown[] {
  let values: unknown[] = [doc]
  for (const part of path.split('.')) {
    values = values.flatMap(v => {
      if (Array.isArray(v)) return v.map(x => (x as Doc | undefined)?.[part])
      return [(v as Doc | undefined)?.[part]]
    })
  }
  return values
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const values = valuesAt(doc, key)
    if (isOp(cond)) {
      if ('$in' in cond)
        return values.some(v => (cond.$in as unknown[]).some(x => eq(x, v)))
      if ('$nin' in cond)
        return !values.some(v => (cond.$nin as unknown[]).some(x => eq(x, v)))
      if ('$ne' in cond) return !values.some(v => eq(cond.$ne, v))
      if ('$exists' in cond)
        return values.some(v => v !== undefined) === cond.$exists
    }
    return values.some(v => eq(cond, v))
  })
}

/** Sao chép nông, giữ nguyên ObjectId/Date (structuredClone làm mất prototype). */
function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (value && typeof value === 'object' && !(value instanceof ObjectId)) {
    if (value instanceof Date) return new Date(value.getTime())
    const out: Doc = {}
    for (const [k, v] of Object.entries(value as Doc)) out[k] = cloneValue(v)
    return out
  }
  return value
}

function cloneDoc(doc: Doc): Doc {
  return cloneValue(doc) as Doc
}

type FakeDb = {
  collections: Record<string, Doc[]>
  indexes: Record<string, string[]>
  /** Số lần gọi updateOne/replaceOne (để kiểm dry-run không ghi). */
  writes: number
  /** Đặt để replaceOne ném lỗi với _id này (kiểm rollback không mất dữ liệu). */
  failReplaceFor?: string
}

function fakeCollection(db: FakeDb, name: string): MigrationCollection {
  const docs = (db.collections[name] ??= [])
  const indexes = (db.indexes[name] ??= [])
  return {
    find: (filter: Doc = {}) => ({
      toArray: () =>
        Promise.resolve(docs.filter(d => matches(d, filter)).map(cloneDoc)),
    }),
    distinct: (key: string) =>
      Promise.resolve([...new Set(docs.map(d => d[key]))]),
    countDocuments: (filter: Doc = {}) =>
      Promise.resolve(docs.filter(d => matches(d, filter)).length),
    updateOne: (filter: Doc, update: Doc) => {
      db.writes += 1
      const target = docs.find(d => matches(d, filter))
      if (!target) return Promise.resolve({ matchedCount: 0, modifiedCount: 0 })
      const set = update.$set as Doc | undefined
      if (set) Object.assign(target, set)
      const unset = update.$unset as Doc | undefined
      if (unset) for (const key of Object.keys(unset)) delete target[key]
      const push = update.$push as Doc | undefined
      if (push) {
        for (const [key, spec] of Object.entries(push)) {
          const list = (target[key] ?? []) as Doc[]
          const each = (spec as { $each: Doc[] }).$each
          const sort = (spec as { $sort?: Record<string, 1 | -1> }).$sort
          const next = [...list, ...each.map(cloneDoc)]
          if (sort) {
            const field = Object.keys(sort)[0] ?? 'sequence'
            const dir = sort[field] ?? 1
            next.sort((a, b) => (Number(a[field]) - Number(b[field])) * dir)
          }
          target[key] = next
        }
      }
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
    },
    replaceOne: (filter: Doc, doc: Doc, options?: { upsert?: boolean }) => {
      db.writes += 1
      if (db.failReplaceFor && String(filter._id) === db.failReplaceFor) {
        return Promise.reject(new Error('simulated write failure'))
      }
      const index = docs.findIndex(d => matches(d, filter))
      if (index >= 0) {
        docs[index] = cloneDoc(doc)
        return Promise.resolve({ matchedCount: 1 })
      }
      if (options?.upsert) docs.push(cloneDoc(doc))
      return Promise.resolve({ matchedCount: 0 })
    },
    deleteMany: (filter: Doc) => {
      db.writes += 1
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        const row = docs[i]
        if (row && matches(row, filter)) docs.splice(i, 1)
      }
      return Promise.resolve({})
    },
    createIndex: (
      keys: Record<string, 1 | -1>,
      options?: { name?: string }
    ) => {
      indexes.push(options?.name ?? Object.keys(keys).join('_'))
      return Promise.resolve(options?.name)
    },
    dropIndex: (name: string) => {
      const at = indexes.indexOf(name)
      if (at < 0) return Promise.reject(new Error('index not found'))
      indexes.splice(at, 1)
      return Promise.resolve({})
    },
  } as MigrationCollection
}

function makeDb(seed: { contracts: Doc[]; amendments: Doc[] }): {
  db: ContractAmendmentsMigrationDb
  state: FakeDb
} {
  const state: FakeDb = {
    collections: {
      contracts: seed.contracts.map(cloneDoc),
      contract_amendments: seed.amendments.map(cloneDoc),
    },
    indexes: {},
    writes: 0,
  }
  return {
    state,
    db: { collection: (name: string) => fakeCollection(state, name) },
  }
}

const coll = (s: FakeDb, name: string): Doc[] => s.collections[name] ?? []

const first = (list: Doc[]): Doc => {
  const [doc] = list
  if (!doc) throw new Error('expected a document')
  return doc
}

const contractOid = (n: number): ObjectId =>
  new ObjectId(n.toString(16).padStart(24, '0'))

function legacyRow(contract: ObjectId, sequence: number, extra: Doc = {}): Doc {
  return {
    _id: new ObjectId(),
    contractId: contract.toHexString(),
    sequence,
    status: 'effective',
    revision: 2,
    changes: [],
    beforeSnapshot: { monthlyRent: 100 },
    afterSnapshot: { monthlyRent: 120 },
    effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
    contentHash: 'c'.repeat(64),
    artifactRef: { artifactId: 'a1', artifactHash: 'h1' },
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    ...extra,
  }
}

describe('027 contract amendments embed', () => {
  it('uses the stable migration id', () => {
    expect(CONTRACT_AMENDMENTS_EMBED_MIGRATION_ID).toBe(
      '027-contract-amendments-embed'
    )
  })

  it('is dry-run by default and writes nothing', async () => {
    const c1 = contractOid(1)
    const { db, state } = makeDb({
      contracts: [{ _id: c1 }],
      amendments: [legacyRow(c1, 1), legacyRow(c1, 2)],
    })

    const report = await migrateContractAmendmentsToEmbedded(db)

    expect(report.dryRun).toBe(true)
    expect(report.sourceAmendments).toBe(2)
    expect(report.updated).toBe(1)
    expect(state.writes).toBe(0)
    expect(first(coll(state, 'contracts')).amendments).toBeUndefined()
    expect(state.indexes.contracts ?? []).toEqual([])
  })

  it('embeds legacy amendments in sequence order, keeps _id and keeps legacy rows', async () => {
    const c1 = contractOid(1)
    const r1 = legacyRow(c1, 1)
    const r2 = legacyRow(c1, 2)
    const { db, state } = makeDb({
      contracts: [{ _id: c1 }],
      amendments: [r2, r1],
    })

    const report = await migrateContractAmendmentsToEmbedded(db, {
      dryRun: false,
    })

    expect(report.errors).toEqual([])
    expect(report.verifiedAmendments).toBe(2)
    const embedded = first(coll(state, 'contracts')).amendments as Doc[]
    expect(embedded.map(a => a.sequence)).toEqual([1, 2])
    const [e0, e1] = embedded as [Doc, Doc]
    expect(String(e0._id)).toBe(String(r1._id))
    expect(String(e1._id)).toBe(String(r2._id))
    expect(e0).not.toHaveProperty('contractId')
    expect(e0.artifactRef).toEqual(r1.artifactRef)
    expect(coll(state, 'contract_amendments')).toHaveLength(2)
  })

  it('is idempotent: a second apply embeds nothing new', async () => {
    const c1 = contractOid(1)
    const { db, state } = makeDb({
      contracts: [{ _id: c1 }],
      amendments: [legacyRow(c1, 1)],
    })
    await migrateContractAmendmentsToEmbedded(db, { dryRun: false })
    const writesAfterFirst = state.writes

    const second = await migrateContractAmendmentsToEmbedded(db, {
      dryRun: false,
    })

    expect(second.updated).toBe(0)
    expect(state.writes).toBe(writesAfterFirst)
    expect((first(coll(state, 'contracts')).amendments as Doc[]).length).toBe(1)
  })

  it('keeps orphan amendments (contract gone) in the legacy collection and reports them', async () => {
    const c1 = contractOid(1)
    const ghost = contractOid(99)
    const orphan = legacyRow(ghost, 1)
    const { db, state } = makeDb({
      contracts: [{ _id: c1 }],
      amendments: [legacyRow(c1, 1), orphan],
    })

    const report = await migrateContractAmendmentsToEmbedded(db, {
      dryRun: false,
    })

    expect(report.orphanAmendments).toBe(1)
    expect(report.orphanContractIds).toEqual([ghost.toHexString()])
    expect(coll(state, 'contract_amendments')).toHaveLength(2)
    expect(
      coll(state, 'contract_amendments').some(
        d => String(d._id) === String(orphan._id)
      )
    ).toBe(true)
  })

  it('does not reject duplicate sequence or idempotencyKey left by dirty legacy data', async () => {
    const c1 = contractOid(1)
    const a = legacyRow(c1, 1, { idempotencyKey: 'k1' })
    const b = legacyRow(c1, 1, { idempotencyKey: 'k1' })
    const { db, state } = makeDb({
      contracts: [{ _id: c1 }],
      amendments: [a, b],
    })

    const report = await migrateContractAmendmentsToEmbedded(db, {
      dryRun: false,
    })

    expect(report.errors).toEqual([])
    expect(report.duplicateSequenceContractIds).toEqual([c1.toHexString()])
    expect(first(coll(state, 'contracts')).amendments as Doc[]).toHaveLength(2)
    expect(coll(state, 'contract_amendments')).toHaveLength(2)
  })

  it('reports oversized contracts, does not cut data, and still migrates the others', async () => {
    const big = contractOid(1)
    const small = contractOid(2)
    const bigRows = Array.from(
      { length: MAX_CONTRACT_AMENDMENTS + 1 },
      (_, i) => legacyRow(big, i + 1)
    )
    const { db, state } = makeDb({
      contracts: [{ _id: big }, { _id: small }],
      amendments: [...bigRows, legacyRow(small, 1)],
    })

    const report = await migrateContractAmendmentsToEmbedded(db, {
      dryRun: false,
    })

    expect(report.oversizedContractIds).toEqual([big.toHexString()])
    expect(report.errors.length).toBeGreaterThan(0)
    const bigDoc = coll(state, 'contracts').find(
      d => String(d._id) === String(big)
    )
    expect(bigDoc?.amendments).toBeUndefined()
    expect(coll(state, 'contract_amendments')).toHaveLength(
      MAX_CONTRACT_AMENDMENTS + 2
    )
    const smallDoc = coll(state, 'contracts').find(
      d => String(d._id) === String(small)
    )
    expect(smallDoc?.amendments as Doc[]).toHaveLength(1)
    // Có lỗi thì không tạo chỉ mục.
    expect(state.indexes.contracts ?? []).toEqual([])
  })

  it('pushes only missing rows into a contract that is already partly embedded', async () => {
    const c1 = contractOid(1)
    const r1 = legacyRow(c1, 1)
    const r2 = legacyRow(c1, 2)
    const { db, state } = makeDb({
      contracts: [{ _id: c1, amendments: [{ ...r1 }] }],
      amendments: [r1, r2],
    })

    const report = await migrateContractAmendmentsToEmbedded(db, {
      dryRun: false,
    })

    expect(report.errors).toEqual([])
    const embedded = first(coll(state, 'contracts')).amendments as Doc[]
    expect(embedded.map(a => String(a._id))).toEqual([
      String(r1._id),
      String(r2._id),
    ])
  })

  it('creates the multikey indexes only after a clean apply', async () => {
    const c1 = contractOid(1)
    const { db, state } = makeDb({
      contracts: [{ _id: c1 }],
      amendments: [legacyRow(c1, 1)],
    })

    const report = await migrateContractAmendmentsToEmbedded(db, {
      dryRun: false,
    })

    expect(report.errors).toEqual([])
    expect(report.indexesCreated).toEqual([
      'contracts_amendments_status_effectiveFrom',
      'contracts_amendments_id',
    ])
    expect(state.indexes.contracts).toEqual(report.indexesCreated)
  })

  it('rollback restores every embedded amendment (including ones added after the switch) and drops indexes', async () => {
    const c1 = contractOid(1)
    const r1 = legacyRow(c1, 1)
    const { db, state } = makeDb({
      contracts: [{ _id: c1 }],
      amendments: [r1],
    })
    await migrateContractAmendmentsToEmbedded(db, { dryRun: false })
    // Sau chuyển code: một phụ lục mới chỉ có trong mảng nhúng.
    const post = legacyRow(c1, 2)
    ;(first(coll(state, 'contracts')).amendments as Doc[]).push(post)
    // Phụ lục bị thay đổi sau chuyển code phải được sao ngược đúng bản mới nhất.
    first(first(coll(state, 'contracts')).amendments as Doc[]).status =
      'superseded'

    const report = await rollbackContractAmendmentsEmbed(db, {
      dryRun: false,
    })

    expect(report.errors).toEqual([])
    const restored = coll(state, 'contract_amendments').filter(
      d => d.contractId === c1.toHexString()
    )
    expect(restored).toHaveLength(2)
    expect(restored.find(d => String(d._id) === String(r1._id))?.status).toBe(
      'superseded'
    )
    expect(first(coll(state, 'contracts')).amendments).toBeUndefined()
    expect(state.indexes.contracts ?? []).toEqual([])
  })

  it('rollback keeps the embedded array when a copy-back fails', async () => {
    const c1 = contractOid(1)
    const r1 = legacyRow(c1, 1)
    const { db, state } = makeDb({
      contracts: [{ _id: c1 }],
      amendments: [r1],
    })
    await migrateContractAmendmentsToEmbedded(db, { dryRun: false })
    state.failReplaceFor = String(r1._id)

    const report = await rollbackContractAmendmentsEmbed(db, {
      dryRun: false,
    })

    expect(report.errors.length).toBeGreaterThan(0)
    expect(first(coll(state, 'contracts')).amendments as Doc[]).toHaveLength(1)
  })

  it('rollback dry-run writes nothing', async () => {
    const c1 = contractOid(1)
    const { db, state } = makeDb({
      contracts: [{ _id: c1 }],
      amendments: [legacyRow(c1, 1)],
    })
    await migrateContractAmendmentsToEmbedded(db, { dryRun: false })
    const before = state.writes

    const report = await rollbackContractAmendmentsEmbed(db)

    expect(report.dryRun).toBe(true)
    expect(state.writes).toBe(before)
    expect(first(coll(state, 'contracts')).amendments).toBeDefined()
  })
})
