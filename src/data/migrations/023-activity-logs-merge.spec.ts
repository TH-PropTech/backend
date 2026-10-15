import { ObjectId } from 'mongodb'
import {
  ACTIVITY_LOG_INDEXES,
  ACTIVITY_LOGS_MERGE_MIGRATION_ID,
  migrateActivityLogs,
  rollbackActivityLogs,
  type ActivityLogMongoDatabase,
} from './023-activity-logs-merge'

type Doc = Record<string, unknown> & { _id: ObjectId }

/** Bộ lọc tối thiểu: `_id` (bằng, $in, $gt), `kind` (bằng, $exists). */
function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([field, condition]) => {
    const value = doc[field]
    if (
      condition === null ||
      typeof condition !== 'object' ||
      condition instanceof ObjectId
    ) {
      return sameValue(value, condition)
    }
    const op = condition as Record<string, unknown>
    if ('$in' in op) {
      return (op.$in as unknown[]).some(item => sameValue(value, item))
    }
    if ('$gt' in op) {
      return key(value) > key(op.$gt)
    }
    if ('$exists' in op) {
      return (value !== undefined) === op.$exists
    }
    return false
  })
}

function key(value: unknown): string {
  return value instanceof ObjectId ? value.toHexString() : String(value)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b
  return key(a) === key(b)
}

interface FakeChain {
  sort(): FakeChain
  limit(n: number): FakeChain
  toArray(): Promise<Doc[]>
}

type Collections = Record<
  | 'activity_logs'
  | 'blockchain_logs'
  | 'job_run_histories'
  | 'recommendation_histories'
  | 'ai_consultation_logs',
  FakeCollection
>

/** Collection giả lập: lưu trong bộ nhớ, ghi lại mọi lần `find` (để kiểm lô). */
class FakeCollection {
  docs: Doc[] = []
  findCalls: Array<{ filter: Record<string, unknown>; limit?: number }> = []
  indexes = new Map<string, Record<string, 1 | -1>>()

  constructor(docs: Doc[] = []) {
    this.docs = docs.map(doc => ({ ...doc }))
  }

  find(filter: Record<string, unknown> = {}): FakeChain {
    const call: { filter: Record<string, unknown>; limit?: number } = {
      filter,
    }
    this.findCalls.push(call)
    let rows = this.docs.filter(doc => matches(doc, filter))
    const chain: FakeChain = {
      sort: (): FakeChain => {
        rows = [...rows].sort((a, b) => key(a._id).localeCompare(key(b._id)))
        return chain
      },
      limit: (n: number): FakeChain => {
        call.limit = n
        rows = rows.slice(0, n)
        return chain
      },
      toArray: (): Promise<Doc[]> =>
        Promise.resolve(rows.map(doc => ({ ...doc }))),
    }
    return chain
  }

  countDocuments(filter: Record<string, unknown> = {}): Promise<number> {
    return Promise.resolve(this.docs.filter(doc => matches(doc, filter)).length)
  }

  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { upsert?: boolean } = {}
  ): Promise<{ upsertedCount: number }> {
    const index = this.docs.findIndex(doc => matches(doc, filter))
    if (index >= 0) {
      const doc = this.docs[index] as Doc
      if (update.$set) Object.assign(doc, update.$set)
      if (update.$unset) {
        for (const field of Object.keys(update.$unset)) {
          delete doc[field]
        }
      }
      return Promise.resolve({ upsertedCount: 0 })
    }
    if (options.upsert) {
      const inserted = {
        ...filter,
        ...(update.$setOnInsert as Record<string, unknown>),
      } as Doc
      this.docs.push(inserted)
      return Promise.resolve({ upsertedCount: 1 })
    }
    return Promise.resolve({ upsertedCount: 0 })
  }

  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>
  ): Promise<{ matchedCount: number }> {
    const index = this.docs.findIndex(doc => matches(doc, filter))
    if (index < 0) return Promise.resolve({ matchedCount: 0 })
    this.docs[index] = { ...replacement } as Doc
    return Promise.resolve({ matchedCount: 1 })
  }

  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount: number }> {
    const before = this.docs.length
    this.docs = this.docs.filter(doc => !matches(doc, filter))
    return Promise.resolve({ deletedCount: before - this.docs.length })
  }

  createIndex(
    keys: Record<string, 1 | -1>,
    options: { name?: string } = {}
  ): Promise<string> {
    const name = options.name ?? Object.keys(keys).join('_')
    this.indexes.set(name, keys)
    return Promise.resolve(name)
  }

  dropIndex(name: string): Promise<unknown> {
    if (!this.indexes.has(name)) {
      return Promise.reject(new Error(`index not found: ${name}`))
    }
    this.indexes.delete(name)
    return Promise.resolve({})
  }
}

const id = (n: number): ObjectId =>
  new ObjectId(`65a0000000000000000000${n.toString(16).padStart(2, '0')}`)

function buildDb(collections: Collections): ActivityLogMongoDatabase {
  const database: ActivityLogMongoDatabase = {
    collection: (name: string) => {
      const found = (collections as Record<string, FakeCollection | undefined>)[
        name
      ]
      if (found) return found
      const created = new FakeCollection()
      ;(collections as Record<string, FakeCollection>)[name] = created
      return created
    },
  }
  return database
}

function seed(): Collections {
  return {
    activity_logs: new FakeCollection([
      { _id: id(1), userId: 'u1', method: 'POST', path: '/a', action: 'x' },
      { _id: id(2), userId: 'u2', method: 'PUT', path: '/b', action: 'y' },
    ]),
    blockchain_logs: new FakeCollection([
      {
        _id: id(10),
        action: 'recordDeposit',
        contractId: 'c-1',
        txHash: 'sim_1',
        details: { a: 1 },
        createdAt: new Date(10),
      },
      {
        _id: id(11),
        action: 'createContract',
        contractId: 'c-2',
        txHash: 'sim_2',
        details: {},
        createdAt: new Date(11),
      },
      {
        _id: id(12),
        action: 'createContract',
        contractId: 'c-3',
        txHash: 'sim_3',
        details: {},
        createdAt: new Date(12),
      },
    ]),
    job_run_histories: new FakeCollection([
      {
        _id: id(20),
        jobName: 'rental-ops',
        trigger: 'cron',
        status: 'running',
        startedAt: new Date(20),
        createdAt: new Date(20),
        updatedAt: new Date(20),
      },
    ]),
    recommendation_histories: new FakeCollection([
      {
        _id: id(30),
        userAge: 30,
        userIncome: 20,
        preferredDistrict: 'Q7',
        preferredBedrooms: 2,
        requiresGym: 1,
        requiresParking: 0,
        rentedApartmentId: 'a-1',
        createdAt: new Date(30),
      },
    ]),
    ai_consultation_logs: new FakeCollection([
      {
        _id: id(40),
        logId: 'call-1',
        userId: null,
        messages: [],
        status: 'pending',
        result: 'not_interested',
        duration: 0,
        createdAt: new Date(40),
        updatedAt: new Date(40),
      },
    ]),
  }
}

describe('023-activity-logs-merge', () => {
  it('dry-run is the default and only reads and counts', async () => {
    const collections = seed()
    const report = await migrateActivityLogs(buildDb(collections))

    expect(report.migrationId).toBe(ACTIVITY_LOGS_MERGE_MIGRATION_ID)
    expect(report.dryRun).toBe(true)
    expect(report.counts.blockchain).toEqual({ source: 3, target: 0 })
    expect(report.counts['job-run']).toEqual({ source: 1, target: 0 })
    expect(report.counts.recommendation).toEqual({ source: 1, target: 0 })
    expect(report.counts['ai-consultation']).toEqual({ source: 1, target: 0 })
    expect(report.counts.http).toEqual({ source: 2, target: 0 })
    expect(report.updated).toBe(3 + 1 + 1 + 1 + 2)
    expect(report.errors).toEqual([])
    expect(collections.activity_logs.docs.some(d => d.kind)).toBe(false)
    expect(collections.activity_logs.indexes.size).toBe(0)
  })

  it('apply copies every source with its kind, keeps _id and backfills http rows', async () => {
    const collections = seed()
    const report = await migrateActivityLogs(buildDb(collections), {
      dryRun: false,
    })

    expect(report.dryRun).toBe(false)
    expect(report.errors).toEqual([])
    const target = collections.activity_logs
    const blockchain = target.docs.find(d => String(d._id) === String(id(10)))
    expect(blockchain).toMatchObject({
      kind: 'blockchain',
      contractId: 'c-1',
      txHash: 'sim_1',
    })
    expect(
      target.docs.filter(d => d.kind === 'blockchain').map(d => String(d._id))
    ).toEqual([id(10), id(11), id(12)].map(String))
    expect(report.counts.blockchain).toEqual({ source: 3, target: 3 })
    expect(report.counts.http).toEqual({ source: 2, target: 2 })
    expect(target.docs.filter(d => d.kind === 'http')).toHaveLength(2)
    expect(target.docs.every(d => d.kind !== undefined)).toBe(true)
  })

  it('creates the kind-prefixed indexes and no unnamed duplicates of the existing ones', async () => {
    const collections = seed()
    await migrateActivityLogs(buildDb(collections), { dryRun: false })

    const created = [...collections.activity_logs.indexes.keys()].sort()
    expect(created).toEqual(ACTIVITY_LOG_INDEXES.map(i => i.name).sort())
    expect(created.every(name => name.startsWith('activity_logs_kind_'))).toBe(
      true
    )
  })

  it('is idempotent: a second apply skips existing rows and adds nothing', async () => {
    const collections = seed()
    const database = buildDb(collections)
    await migrateActivityLogs(database, { dryRun: false })
    const countAfterFirst = collections.activity_logs.docs.length

    const second = await migrateActivityLogs(database, { dryRun: false })

    expect(collections.activity_logs.docs.length).toBe(countAfterFirst)
    expect(second.updated).toBe(0)
    expect(second.skipped).toBe(3 + 1 + 1 + 1)
    expect(second.errors).toEqual([])
  })

  it('reads sources in batches and never loads a whole collection at once', async () => {
    const collections = seed()
    await migrateActivityLogs(buildDb(collections), {
      dryRun: false,
      batchSize: 2,
    })

    const sourceCalls = [
      ...collections.blockchain_logs.findCalls,
      ...collections.job_run_histories.findCalls,
      ...collections.recommendation_histories.findCalls,
      ...collections.ai_consultation_logs.findCalls,
    ]
    expect(sourceCalls.length).toBeGreaterThan(4)
    expect(sourceCalls.every(call => call.limit === 2)).toBe(true)
    expect(collections.blockchain_logs.findCalls[1]?.filter).toEqual({
      _id: { $gt: id(11) },
    })
    expect(collections.blockchain_logs.docs.length).toBe(3)
  })

  it('reports and keeps a row whose _id already exists with another kind', async () => {
    const collections = seed()
    collections.activity_logs.docs.push({
      _id: id(10),
      kind: 'job-run',
      jobName: 'other',
    })

    const dry = await migrateActivityLogs(buildDb(collections))
    expect(dry.errors).toHaveLength(1)
    expect(dry.errors[0]).toContain('blockchain_logs:')

    const applied = await migrateActivityLogs(buildDb(collections), {
      dryRun: false,
    })
    expect(applied.errors).toHaveLength(1)
    expect(
      collections.activity_logs.docs.find(d => String(d._id) === String(id(10)))
        ?.kind
    ).toBe('job-run')
  })

  it('rollback restores post-cutover changes to legacy shape and removes kind rows', async () => {
    const collections = seed()
    const database = buildDb(collections)
    await migrateActivityLogs(database, { dryRun: false })
    // Sau chuyển code: job cập nhật trạng thái, có thêm một bản ghi blockchain mới.
    const job = collections.activity_logs.docs.find(
      d => String(d._id) === String(id(20))
    ) as Doc
    job.status = 'success'
    collections.activity_logs.docs.push({
      _id: id(50),
      kind: 'blockchain',
      action: 'recordHandover',
      txHash: 'sim_new',
      details: {},
      createdAt: new Date(50),
    })

    const report = await rollbackActivityLogs(database, {
      dryRun: false,
      batchSize: 2,
    })

    expect(report.errors).toEqual([])
    expect(report.restored).toBeGreaterThan(0)
    const restoredJob = collections.job_run_histories.docs.find(
      d => String(d._id) === String(id(20))
    )
    expect(restoredJob).toMatchObject({
      status: 'success',
      jobName: 'rental-ops',
    })
    expect(restoredJob).not.toHaveProperty('kind')
    const restoredNew = collections.blockchain_logs.docs.find(
      d => String(d._id) === String(id(50))
    )
    expect(restoredNew).toMatchObject({ action: 'recordHandover' })
    // Blockchain cũ không có updatedAt: rollback không thêm trường ngoài hình cũ.
    expect(restoredNew).not.toHaveProperty('updatedAt')
    expect(restoredNew).not.toHaveProperty('kind')
    expect(
      collections.activity_logs.docs.filter(d => d.kind && d.kind !== 'http')
    ).toHaveLength(0)
    expect(
      collections.activity_logs.docs.every(d => d.kind === undefined)
    ).toBe(true)
    expect(collections.activity_logs.indexes.size).toBe(0)
  })

  it('rollback dry-run changes nothing', async () => {
    const collections = seed()
    const database = buildDb(collections)
    await migrateActivityLogs(database, { dryRun: false })
    const before = JSON.stringify(collections.activity_logs.docs)

    const report = await rollbackActivityLogs(database)

    expect(report.dryRun).toBe(true)
    expect(JSON.stringify(collections.activity_logs.docs)).toBe(before)
    expect(collections.activity_logs.indexes.size).toBe(
      ACTIVITY_LOG_INDEXES.length
    )
  })
})
