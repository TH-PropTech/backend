/* eslint-disable @typescript-eslint/explicit-function-return-type -- in-memory fakes */
import { ObjectId } from 'mongodb'
import {
  FEE_GROQ_INDEXES,
  FEE_GROQ_MIGRATION_ID,
  migrateSystemConfigsFeeGroq,
  rollbackSystemConfigsFeeGroq,
  type FeeGroqMongoCollection,
  type FeeGroqMongoDatabase,
} from './022-system-configs-fee-groq'

type Doc = Record<string, unknown> & { _id: ObjectId }

class FakeCollection implements FeeGroqMongoCollection {
  docs: Doc[] = []
  indexes = new Map<
    string,
    {
      keys: Record<string, 1 | -1>
      unique?: boolean | undefined
      partialFilterExpression?: Record<string, unknown> | undefined
    }
  >()
  writes = 0

  private matches(doc: Doc, filter: Record<string, unknown> = {}): boolean {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in v) {
        return (v as { $in: ObjectId[] }).$in.some(x =>
          (doc[k] as ObjectId | undefined)?.equals?.(x)
        )
      }
      if (v instanceof ObjectId) {
        return (doc[k] as ObjectId | undefined)?.equals?.(v) === true
      }
      return doc[k] === v
    })
  }

  find(filter?: Record<string, unknown>): { toArray(): Promise<Doc[]> } {
    return {
      toArray: () =>
        Promise.resolve(
          this.docs.filter(d => this.matches(d, filter)).map(d => ({ ...d }))
        ),
    }
  }

  countDocuments(filter?: Record<string, unknown>): Promise<number> {
    return Promise.resolve(
      this.docs.filter(d => this.matches(d, filter)).length
    )
  }

  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<unknown> {
    const target = this.docs.find(d => this.matches(d, filter))
    if (target) {
      if (update.$set) {
        this.writes += 1
        Object.assign(target, update.$set)
      }
      return Promise.resolve({})
    }
    if (!options?.upsert) return Promise.resolve({})
    this.writes += 1
    this.docs.push({
      ...(filter as { _id: ObjectId }),
      ...(update.$setOnInsert as Record<string, unknown>),
    })
    return Promise.resolve({})
  }

  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount?: number }> {
    const before = this.docs.length
    this.docs = this.docs.filter(d => !this.matches(d, filter))
    this.writes += 1
    return Promise.resolve({ deletedCount: before - this.docs.length })
  }

  createIndex(
    keys: Record<string, 1 | -1>,
    options?: {
      name?: string
      unique?: boolean
      partialFilterExpression?: Record<string, unknown>
    }
  ): Promise<string> {
    const name = options?.name ?? JSON.stringify(keys)
    this.indexes.set(name, {
      keys,
      unique: options?.unique,
      partialFilterExpression: options?.partialFilterExpression,
    })
    return Promise.resolve(name)
  }

  dropIndex(name: string): Promise<unknown> {
    if (!this.indexes.delete(name)) return Promise.reject(new Error('no index'))
    return Promise.resolve()
  }
}

function setup(): {
  db: FeeGroqMongoDatabase
  fees: FakeCollection
  groq: FakeCollection
  target: FakeCollection
} {
  const fees = new FakeCollection()
  const groq = new FakeCollection()
  const target = new FakeCollection()
  const db: FeeGroqMongoDatabase = {
    collection: name =>
      name === 'platform_fee_schedules'
        ? fees
        : name === 'groq_api_keys'
          ? groq
          : target,
  }
  return { db, fees, groq, target }
}

const t0 = new Date('2026-01-01T00:00:00Z')
const T0_MS = t0.getTime()

function seedLegacy(fees: FakeCollection, groq: FakeCollection) {
  const f1 = {
    _id: new ObjectId(),
    scheduleId: 'fee-1',
    version: 1,
    status: 'archived',
    effectiveFrom: t0,
    rules: { transactionTypes: {} },
    legalReviewStatus: 'reviewed',
    reviewReference: 'LR-1',
    contentHash: 'h1',
    draftRevision: 3,
    createdBy: 'admin-1',
    publishedBy: 'admin-2',
    publishedAt: t0,
    createdAt: t0,
    updatedAt: t0,
  }
  const f2 = {
    _id: new ObjectId(),
    scheduleId: 'fee-1',
    version: 2,
    status: 'published',
    effectiveFrom: t0,
    rules: { transactionTypes: {} },
    legalReviewStatus: 'reviewed',
    reviewReference: 'LR-2',
    contentHash: 'h2',
    draftRevision: 1,
    createdBy: 'admin-1',
    publishedBy: 'admin-2',
    publishedAt: t0,
    createdAt: t0,
    updatedAt: t0,
  }
  const g1 = {
    _id: new ObjectId(),
    keyEnc: 'enc-1',
    keyHash: 'hash-1',
    keyMask: 'gsk_abcd...0001',
    status: 'active',
    cooldownUntil: 0,
    usageCount: 4,
    failCount: 1,
    lastUsedAt: T0_MS,
    lastError: 'Hết hạn mức',
    createdAt: T0_MS - 5000,
  }
  const g2 = {
    _id: new ObjectId(),
    keyEnc: 'enc-2',
    keyHash: 'hash-2',
    keyMask: 'gsk_abcd...0002',
    status: 'invalid',
    cooldownUntil: 0,
    usageCount: 0,
    failCount: 2,
    lastUsedAt: 0,
    createdAt: T0_MS - 1000,
    check: { at: T0_MS, ok: false, models: [] },
  }
  fees.docs.push(f1, f2)
  groq.docs.push(g1, g2)
  return { f1, f2, g1, g2 }
}

/** Hàng của scope khác (job, recommendation) cùng collection đích: không được đếm/đụng. */
function seedOtherScopes(target: FakeCollection): {
  job: Doc
  rec: Doc
} {
  const job: Doc = {
    _id: new ObjectId(),
    scope: 'job',
    key: 'apartment-expiration',
    enabled: true,
    createdAt: t0,
    updatedAt: t0,
  }
  const rec: Doc = {
    _id: new ObjectId(),
    scope: 'recommendation',
    key: 'global',
    strategy: 'hybrid',
    createdAt: t0,
    updatedAt: t0,
  }
  target.docs.push(job, rec)
  return { job, rec }
}

describe('022 system_configs fee + groq (dry-run mặc định)', () => {
  it('dry-run reports counts without writing or creating indexes', async () => {
    const { db, fees, groq, target } = setup()
    seedLegacy(fees, groq)
    seedOtherScopes(target)

    const report = await migrateSystemConfigsFeeGroq(db)

    expect(report.migrationId).toBe(FEE_GROQ_MIGRATION_ID)
    expect(report.dryRun).toBe(true)
    expect(report.counts['platform-fee']).toEqual({ source: 2, target: 0 })
    expect(report.counts['groq-key']).toEqual({ source: 2, target: 0 })
    expect(report.updated).toBe(4)
    expect(target.writes).toBe(0)
    expect(target.indexes.size).toBe(0)
  })

  it('rollback dry-run changes nothing', async () => {
    const { db, fees, groq, target } = setup()
    seedLegacy(fees, groq)
    await migrateSystemConfigsFeeGroq(db, { dryRun: false })
    const before = target.docs.length
    const writes = target.writes

    await rollbackSystemConfigsFeeGroq(db)

    expect(target.docs).toHaveLength(before)
    expect(target.writes).toBe(writes)
    expect(target.indexes.size).toBe(FEE_GROQ_INDEXES.length + 1)
  })
})

describe('022 apply', () => {
  it('copies fee and groq rows with scope/key, keeps _id, converts groq createdAt to Date', async () => {
    const { db, fees, groq, target } = setup()
    const { f1, g1 } = seedLegacy(fees, groq)
    const { job, rec } = seedOtherScopes(target)

    const report = await migrateSystemConfigsFeeGroq(db, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report.counts['platform-fee'].target).toBe(2)
    expect(report.counts['groq-key'].target).toBe(2)
    const feeRow = target.docs.find(d => d._id.equals(f1._id))
    expect(feeRow).toMatchObject({
      scope: 'platform-fee',
      key: 'fee-1@1',
      scheduleId: 'fee-1',
      version: 1,
      status: 'archived',
      contentHash: 'h1',
    })
    const groqRow = target.docs.find(d => d._id.equals(g1._id))
    expect(groqRow).toMatchObject({
      scope: 'groq-key',
      key: 'hash-1',
      keyEnc: 'enc-1',
      keyHash: 'hash-1',
      usageCount: 4,
      lastError: 'Hết hạn mức',
    })
    expect(groqRow?.createdAt).toEqual(new Date(T0_MS - 5000))
    // Hàng scope khác không bị đổi.
    expect(target.docs.find(d => d._id.equals(job._id))).toEqual(job)
    expect(target.docs.find(d => d._id.equals(rec._id))).toEqual(rec)
  })

  it('is idempotent by _id: a second apply writes nothing new', async () => {
    const { db, fees, groq, target } = setup()
    seedLegacy(fees, groq)
    await migrateSystemConfigsFeeGroq(db, { dryRun: false })
    const writes = target.writes
    const count = target.docs.length

    const again = await migrateSystemConfigsFeeGroq(db, { dryRun: false })

    expect(again.updated).toBe(0)
    expect(again.skipped).toBe(4)
    expect(target.docs).toHaveLength(count)
    expect(target.writes).toBe(writes)
  })

  it('creates the partial unique indexes per scope and the claim/status indexes', async () => {
    const { db, fees, groq, target } = setup()
    seedLegacy(fees, groq)

    await migrateSystemConfigsFeeGroq(db, { dryRun: false })

    const feeUnique = target.indexes.get('system_configs_fee_schedule_unique')
    expect(feeUnique).toMatchObject({
      keys: { scheduleId: 1, version: 1 },
      unique: true,
      partialFilterExpression: { scope: 'platform-fee' },
    })
    const groqUnique = target.indexes.get('system_configs_groq_keyhash_unique')
    expect(groqUnique).toMatchObject({
      keys: { keyHash: 1 },
      unique: true,
      partialFilterExpression: { scope: 'groq-key' },
    })
    expect(target.indexes.get('system_configs_groq_claim')?.keys).toEqual({
      scope: 1,
      status: 1,
      cooldownUntil: 1,
      createdAt: 1,
    })
    expect(target.indexes.has('system_configs_fee_status_effective')).toBe(true)
    expect(target.indexes.has('system_configs_scope_key_unique')).toBe(true)
  })

  it('reports a duplicate groq keyHash in the source and copies only the first', async () => {
    const { db, fees, groq, target } = setup()
    const { g1 } = seedLegacy(fees, groq)
    groq.docs.push({ ...g1, _id: new ObjectId() })

    const report = await migrateSystemConfigsFeeGroq(db, { dryRun: false })

    expect(report.duplicateIds).toHaveLength(1)
    expect(report.counts['groq-key'].target).toBe(2)
    expect(target.docs.filter(d => d.scope === 'groq-key')).toHaveLength(2)
  })

  it('refuses to overwrite a row with the same (scope,key) but another _id', async () => {
    const { db, fees, groq, target } = setup()
    const { g1 } = seedLegacy(fees, groq)
    target.docs.push({
      _id: new ObjectId(),
      scope: 'groq-key',
      key: g1.keyHash,
      keyEnc: 'other',
      createdAt: t0,
    })

    const report = await migrateSystemConfigsFeeGroq(db, { dryRun: false })

    expect(report.errors.join(' ')).toMatch(/groq-key/)
    expect(target.docs.find(d => d.keyEnc === 'other')).toBeDefined()
    expect(target.docs.find(d => d._id.equals(g1._id))).toBeUndefined()
  })

  it('throws when the _id count check in the target scope does not match', async () => {
    const { db, fees, groq, target } = setup()
    const { f1 } = seedLegacy(fees, groq)
    // _id của bản ghi nguồn bị chiếm bởi hàng `job`: không được tính là đã sao.
    target.docs.push({
      _id: f1._id,
      scope: 'job',
      key: 'other-job',
      createdAt: t0,
      updatedAt: t0,
    })

    await expect(
      migrateSystemConfigsFeeGroq(db, { dryRun: false })
    ).rejects.toThrow(/count mismatch for scope platform-fee/)
  })
})

describe('022 rollback', () => {
  it('restores fee and groq rows to legacy collections, keeps post-cutover writes, drops scope and indexes', async () => {
    const { db, fees, groq, target } = setup()
    const { f1, g1 } = seedLegacy(fees, groq)
    const { job, rec } = seedOtherScopes(target)
    await migrateSystemConfigsFeeGroq(db, { dryRun: false })

    // Ghi sau khi chuyển code: đổi trạng thái khóa, thêm khóa mới, đổi biểu phí.
    const groqInTarget = target.docs.find(d => d._id.equals(g1._id))
    if (groqInTarget) {
      groqInTarget.status = 'disabled'
      groqInTarget.usageCount = 9
    }
    const newKey = {
      _id: new ObjectId(),
      scope: 'groq-key',
      key: 'hash-new',
      keyEnc: 'enc-new',
      keyHash: 'hash-new',
      keyMask: 'gsk_new',
      status: 'active',
      cooldownUntil: 0,
      usageCount: 0,
      failCount: 0,
      lastUsedAt: 0,
      createdAt: new Date(T0_MS + 1000),
    }
    target.docs.push(newKey)
    const feeInTarget = target.docs.find(d => d._id.equals(f1._id))
    if (feeInTarget) feeInTarget.status = 'published'

    const report = await rollbackSystemConfigsFeeGroq(db, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(fees.docs.find(d => d._id.equals(f1._id))?.status).toBe('published')
    expect(groq.docs.find(d => d._id.equals(g1._id))).toMatchObject({
      status: 'disabled',
      usageCount: 9,
      createdAt: T0_MS - 5000,
    })
    const restoredNew = groq.docs.find(d => d._id.equals(newKey._id))
    expect(restoredNew).toMatchObject({
      keyHash: 'hash-new',
      keyEnc: 'enc-new',
      createdAt: T0_MS + 1000,
    })
    expect(restoredNew).not.toHaveProperty('scope')
    expect(restoredNew).not.toHaveProperty('key')
    expect(target.docs.some(d => d.scope === 'platform-fee')).toBe(false)
    expect(target.docs.some(d => d.scope === 'groq-key')).toBe(false)
    expect(target.docs.find(d => d._id.equals(job._id))).toEqual(job)
    expect(target.docs.find(d => d._id.equals(rec._id))).toEqual(rec)
    expect(target.indexes.has('system_configs_fee_schedule_unique')).toBe(false)
    expect(target.indexes.has('system_configs_groq_keyhash_unique')).toBe(false)
    expect(target.indexes.has('system_configs_groq_claim')).toBe(false)
    expect(target.indexes.has('system_configs_fee_status_effective')).toBe(
      false
    )
  })

  it('keeps the scope when a legacy key cannot be restored', async () => {
    const { db, fees, groq, target } = setup()
    seedLegacy(fees, groq)
    await migrateSystemConfigsFeeGroq(db, { dryRun: false })
    // Hàng fee bị xóa khỏi collection cũ: không khớp _id cũng không khớp khóa
    // thì rollback vẫn chèn lại; để kiểm tra nhánh báo lỗi, xóa sạch `fees` sau khi
    // bản sao ngược đã đọc danh sách (giả lập collection bị xóa giữa chừng).
    const originalFind = fees.find.bind(fees)
    let calls = 0
    fees.find = (filter?: Record<string, unknown>) => {
      calls += 1
      if (calls === 2) {
        return { toArray: () => Promise.resolve([]) }
      }
      return originalFind(filter)
    }

    const report = await rollbackSystemConfigsFeeGroq(db, { dryRun: false })

    expect(report.errors.join(' ')).toMatch(/platform-fee/)
    expect(target.docs.some(d => d.scope === 'platform-fee')).toBe(true)
  })
})
