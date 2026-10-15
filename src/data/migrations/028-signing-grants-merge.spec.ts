import { ObjectId } from 'mongodb'
import {
  GRANT_TOKEN_HASH_FALLBACK_INDEX,
  GRANT_TOKEN_HASH_UNIQUE_INDEX,
  LEGACY_PROVIDER_TX_INDEX_KEY,
  SESSION_KIND_CONTRACT_INDEX,
  SESSION_PROVIDER_TX_FALLBACK_INDEX,
  SESSION_PROVIDER_TX_UNIQUE_INDEX,
  SIGNING_GRANTS_MERGE_MIGRATION_ID,
  migrateSigningGrants,
  rollbackSigningGrants,
  type SigningMongoCollection,
  type SigningMongoDatabase,
} from './028-signing-grants-merge'

type Doc = Record<string, unknown> & { _id: ObjectId }
type IndexSpec = {
  name: string
  key: Record<string, 1 | -1>
  unique?: boolean | undefined
  partialFilterExpression?: Record<string, unknown> | undefined
}

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof ObjectId) {
    return actual instanceof ObjectId && actual.equals(expected)
  }
  if (expected === null) return actual === null || actual === undefined
  if (expected && typeof expected === 'object') {
    const ops = expected as Record<string, unknown>
    if ('$in' in ops) {
      return (ops.$in as unknown[]).some(v => matchValue(actual, v))
    }
    if ('$exists' in ops) return (actual !== undefined) === ops.$exists
    if ('$ne' in ops) return !matchValue(actual, ops.$ne)
    throw new Error('unsupported filter ' + JSON.stringify(expected))
  }
  return actual === expected
}

function matches(doc: Doc, filter: Record<string, unknown> = {}): boolean {
  return Object.entries(filter).every(([k, v]) => matchValue(doc[k], v))
}

/** Giả lập Collection: đủ để kiểm hành vi, kể cả unique index (ném E11000 khi dữ liệu trùng). */
class FakeCollection implements SigningMongoCollection {
  docs: Doc[] = []
  specs = new Map<string, IndexSpec>()

  find(filter?: Record<string, unknown>): { toArray(): Promise<Doc[]> } {
    return {
      toArray: () =>
        Promise.resolve(
          this.docs.filter(d => matches(d, filter)).map(d => ({ ...d }))
        ),
    }
  }

  countDocuments(filter?: Record<string, unknown>): Promise<number> {
    return Promise.resolve(this.docs.filter(d => matches(d, filter)).length)
  }

  distinct(key: string, filter?: Record<string, unknown>): Promise<unknown[]> {
    const values = this.docs
      .filter(d => matches(d, filter) && d[key] !== undefined)
      .map(d => d[key])
    return Promise.resolve([...new Set(values)])
  }

  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<{ upsertedCount?: number; matchedCount?: number }> {
    const current = this.docs.find(d => matches(d, filter))
    if (current) {
      if (update.$set) Object.assign(current, update.$set)
      return Promise.resolve({ matchedCount: 1, upsertedCount: 0 })
    }
    if (!options?.upsert) return Promise.resolve({ matchedCount: 0 })
    const doc = {
      ...(filter as { _id: ObjectId }),
      ...(update.$setOnInsert as Record<string, unknown>),
    } as Doc
    this.insert(doc)
    return Promise.resolve({ upsertedCount: 1, matchedCount: 0 })
  }

  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ modifiedCount?: number }> {
    let modifiedCount = 0
    for (const doc of this.docs) {
      if (!matches(doc, filter)) continue
      if (update.$set) Object.assign(doc, update.$set)
      if (update.$unset) {
        for (const key of Object.keys(update.$unset)) delete doc[key]
      }
      modifiedCount += 1
    }
    return Promise.resolve({ modifiedCount })
  }

  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>
  ): Promise<{ matchedCount?: number }> {
    const index = this.docs.findIndex(d => matches(d, filter))
    if (index < 0) return Promise.resolve({ matchedCount: 0 })
    const current = this.docs[index]!
    this.docs[index] = { _id: current._id, ...replacement }
    return Promise.resolve({ matchedCount: 1 })
  }

  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount?: number }> {
    const before = this.docs.length
    this.docs = this.docs.filter(d => !matches(d, filter))
    return Promise.resolve({ deletedCount: before - this.docs.length })
  }

  indexes(): Promise<IndexSpec[]> {
    return Promise.resolve([...this.specs.values()].map(s => ({ ...s })))
  }

  createIndex(
    keys: Record<string, 1 | -1>,
    options?: {
      name?: string
      unique?: boolean
      partialFilterExpression?: Record<string, unknown>
    }
  ): Promise<string> {
    const spec: IndexSpec = {
      name: options?.name ?? JSON.stringify(keys),
      key: keys,
      unique: options?.unique,
      partialFilterExpression: options?.partialFilterExpression,
    }
    const existing = this.specs.get(spec.name)
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(spec)) {
        return Promise.resolve(spec.name)
      }
      return Promise.reject(new Error('index exists with different options'))
    }
    if (spec.unique) {
      const field = Object.keys(keys)[0] as string
      const seen = new Set<string>()
      for (const doc of this.docs) {
        if (
          spec.partialFilterExpression &&
          !matches(doc, spec.partialFilterExpression)
        ) {
          continue
        }
        const value = JSON.stringify(doc[field] ?? null)
        if (seen.has(value)) {
          return Promise.reject(new Error('E11000 duplicate key ' + value))
        }
        seen.add(value)
      }
    }
    this.specs.set(spec.name, spec)
    return Promise.resolve(spec.name)
  }

  dropIndex(name: string): Promise<unknown> {
    if (!this.specs.delete(name)) return Promise.reject(new Error('no index'))
    return Promise.resolve()
  }

  insert(doc: Doc): void {
    this.docs.push(doc)
  }
}

function buildDatabase(): {
  database: SigningMongoDatabase
  collections: Record<string, FakeCollection>
} {
  const collections: Record<string, FakeCollection> = {}
  return {
    collections,
    database: {
      collection: (name: string) =>
        (collections[name] ??= new FakeCollection()),
    },
  }
}

function col(
  collections: Record<string, FakeCollection>,
  name: string
): FakeCollection {
  const found = collections[name]
  if (!found) throw new Error('missing collection ' + name)
  return found
}

const SESSIONS = 'smartca_signing_sessions'
const GRANTS = 'signing_grants'
const t = (n: number): Date => new Date(Date.UTC(2026, 0, n))

/** Giống lỗi driver thật khi `listIndexes` gọi trên collection chưa tồn tại. */
function namespaceNotFound(): Error {
  return Object.assign(
    new Error('ns does not exist: proptech.smartca_signing_sessions'),
    { code: 26, codeName: 'NamespaceNotFound' }
  )
}

describe('028 signing grants merge migration', () => {
  let sessionId: ObjectId
  let grantA: ObjectId
  let grantB: ObjectId

  /**
   * Trạng thái trước chuyển code: 1 phiên (chưa có kind) và 2 grant ở collection
   * cũ. Collection phiên có unique (không partial) trên providerTransactionId,
   * như TypeORM đã tạo khi còn entity cũ.
   */
  function seedClean(collections: Record<string, FakeCollection>): void {
    sessionId = new ObjectId()
    grantA = new ObjectId()
    grantB = new ObjectId()
    const sessions = (collections[SESSIONS] = new FakeCollection())
    sessions.insert({
      _id: sessionId,
      contractId: 'c-1',
      signerId: 'u-1',
      signerRole: 'tenant',
      artifactHash: 'art-1',
      providerTransactionId: 'tx-1',
      status: 'pending',
      expiresAt: t(9),
      createdAt: t(1),
      updatedAt: t(1),
    })
    sessions.specs.set('providerTransactionId_1', {
      name: 'providerTransactionId_1',
      key: { providerTransactionId: 1 },
      unique: true,
    })
    const grants = (collections[GRANTS] = new FakeCollection())
    grants.insert({
      _id: grantA,
      tokenHash: 'h-a',
      userId: 'u-1',
      role: 'tenant',
      contractId: 'c-1',
      contentLockedHash: 'lock-1',
      biometricGrantId: 'bio-1',
      otpSessionId: 'otp-1',
      expiresAt: t(9),
      consumedAt: null,
      createdAt: t(2),
    })
    grants.insert({
      _id: grantB,
      tokenHash: 'h-b',
      userId: 'u-2',
      role: 'landlord',
      contractId: 'c-1',
      contentLockedHash: 'lock-1',
      biometricGrantId: 'bio-2',
      otpSessionId: 'otp-2',
      expiresAt: t(9),
      consumedAt: t(3),
      createdAt: t(2),
    })
  }

  describe('migrate', () => {
    it('is a dry run by default: counts and plans but writes nothing', async () => {
      const { database, collections } = buildDatabase()
      seedClean(collections)

      const report = await migrateSigningGrants(database)

      expect(report).toMatchObject({
        migrationId: SIGNING_GRANTS_MERGE_MIGRATION_ID,
        dryRun: true,
        scanned: 2,
        updated: 2,
        skipped: 0,
        errors: [],
        grants: { source: 2, target: 0 },
        sessionsBackfilled: 1,
      })
      expect(col(collections, SESSIONS).docs[0]).not.toHaveProperty('kind')
      expect(col(collections, SESSIONS).docs).toHaveLength(1)
      expect(
        col(collections, SESSIONS).specs.has('providerTransactionId_1')
      ).toBe(true)
    })

    it('copies grants by _id with kind, backfills session kind, rebuilds unique indexes as partial', async () => {
      const { database, collections } = buildDatabase()
      seedClean(collections)

      const report = await migrateSigningGrants(database, { dryRun: false })

      const target = col(collections, SESSIONS)
      expect(report.errors).toEqual([])
      expect(report.warnings).toEqual([])
      expect(report.grants).toEqual({ source: 2, target: 2 })

      const session = target.docs.find(d => d._id.equals(sessionId))
      expect(session?.kind).toBe('session')

      const grant = target.docs.find(d => d._id.equals(grantA))
      expect(grant).toEqual({
        _id: grantA,
        kind: 'grant',
        tokenHash: 'h-a',
        userId: 'u-1',
        role: 'tenant',
        contractId: 'c-1',
        contentLockedHash: 'lock-1',
        biometricGrantId: 'bio-1',
        otpSessionId: 'otp-1',
        expiresAt: t(9),
        consumedAt: null,
        createdAt: t(2),
      })

      // Unique cũ không partial đã bị bỏ: grant không có providerTransactionId.
      expect(target.specs.has('providerTransactionId_1')).toBe(false)
      expect(target.specs.get(SESSION_PROVIDER_TX_UNIQUE_INDEX)).toEqual({
        name: SESSION_PROVIDER_TX_UNIQUE_INDEX,
        key: { providerTransactionId: 1 },
        unique: true,
        partialFilterExpression: { kind: 'session' },
      })
      expect(target.specs.get(GRANT_TOKEN_HASH_UNIQUE_INDEX)).toEqual({
        name: GRANT_TOKEN_HASH_UNIQUE_INDEX,
        key: { tokenHash: 1 },
        unique: true,
        partialFilterExpression: { kind: 'grant' },
      })
      expect(target.specs.get(SESSION_KIND_CONTRACT_INDEX)?.key).toEqual({
        kind: 1,
        contractId: 1,
        signerId: 1,
        artifactHash: 1,
        status: 1,
      })
    })

    it('is idempotent: a second apply copies nothing and keeps one row per _id', async () => {
      const { database, collections } = buildDatabase()
      seedClean(collections)
      await migrateSigningGrants(database, { dryRun: false })

      const second = await migrateSigningGrants(database, { dryRun: false })

      expect(second).toMatchObject({ updated: 0, skipped: 2, errors: [] })
      expect(col(collections, SESSIONS).docs).toHaveLength(3)
    })

    it('does not dedupe dirty data: duplicate tokenHash, duplicate or missing providerTransactionId only get plain indexes and warnings', async () => {
      const { database, collections } = buildDatabase()
      seedClean(collections)
      const target = col(collections, SESSIONS)
      target.insert({
        _id: new ObjectId(),
        contractId: 'c-2',
        signerId: 'u-3',
        signerRole: 'landlord',
        artifactHash: 'art-2',
        providerTransactionId: 'tx-1',
        status: 'signed',
        expiresAt: t(9),
        createdAt: t(4),
      })
      target.insert({
        _id: new ObjectId(),
        contractId: 'c-3',
        signerId: 'u-4',
        signerRole: 'tenant',
        artifactHash: 'art-3',
        status: 'expired',
        expiresAt: t(9),
        createdAt: t(4),
      })
      const grants = col(collections, GRANTS)
      grants.insert({
        _id: new ObjectId(),
        tokenHash: 'h-a',
        userId: 'u-9',
        role: 'tenant',
        contractId: 'c-9',
        contentLockedHash: 'lock-9',
        biometricGrantId: 'bio-9',
        otpSessionId: 'otp-9',
        expiresAt: t(9),
        consumedAt: null,
        createdAt: t(5),
      })

      const report = await migrateSigningGrants(database, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(report.grants).toEqual({ source: 3, target: 3 })
      expect(report.warnings).toHaveLength(2)
      expect(target.specs.get(SESSION_PROVIDER_TX_FALLBACK_INDEX)).toEqual({
        name: SESSION_PROVIDER_TX_FALLBACK_INDEX,
        key: { kind: 1, providerTransactionId: 1 },
      })
      expect(target.specs.get(GRANT_TOKEN_HASH_FALLBACK_INDEX)).toEqual({
        name: GRANT_TOKEN_HASH_FALLBACK_INDEX,
        key: { kind: 1, tokenHash: 1 },
      })
      expect(target.specs.has(SESSION_PROVIDER_TX_UNIQUE_INDEX)).toBe(false)
      expect(target.specs.has(GRANT_TOKEN_HASH_UNIQUE_INDEX)).toBe(false)
    })

    it('reports and leaves the session untouched when a grant _id already exists in the target with another kind', async () => {
      const { database, collections } = buildDatabase()
      seedClean(collections)
      col(collections, SESSIONS).insert({
        _id: grantA,
        contractId: 'c-x',
        signerId: 'u-x',
        signerRole: 'tenant',
        artifactHash: 'a',
        providerTransactionId: 'tx-x',
        status: 'pending',
        expiresAt: t(9),
        createdAt: t(1),
      })

      const dry = await migrateSigningGrants(database)
      expect(dry.errors).toHaveLength(1)

      const applied = await migrateSigningGrants(database, { dryRun: false })
      expect(applied.errors).toHaveLength(1)
      expect(col(collections, GRANTS).docs).toHaveLength(2)
      // phiên cũ giữ nguyên `_id` và nội dung (chỉ được gắn kind 'session'), grant trùng không ghi đè
      expect(col(collections, SESSIONS).docs[1]).toMatchObject({
        _id: grantA,
        kind: 'session',
        providerTransactionId: 'tx-x',
      })
    })

    it('fails when the copied grants cannot be found by _id after apply', async () => {
      const { database, collections } = buildDatabase()
      seedClean(collections)
      const target = col(collections, SESSIONS)
      target.updateOne = (): Promise<{ upsertedCount: number }> =>
        Promise.resolve({ upsertedCount: 0 })

      await expect(
        migrateSigningGrants(database, { dryRun: false })
      ).rejects.toThrow('count mismatch for grant (expected 2, found 0)')
    })
  })

  describe('khi collection phiên chưa tồn tại (driver ném NamespaceNotFound)', () => {
    /** Chưa có phiên nào: `indexes()` ném NamespaceNotFound như driver thật. */
    function seedMissingSessions(): {
      database: SigningMongoDatabase
      collections: Record<string, FakeCollection>
    } {
      const built = buildDatabase()
      seedClean(built.collections)
      const sessions = col(built.collections, SESSIONS)
      sessions.docs = []
      sessions.specs.clear()
      sessions.indexes = (): Promise<IndexSpec[]> =>
        Promise.reject(namespaceNotFound())
      return built
    }

    it('migrate dry-run không ném và không ghi', async () => {
      const { database, collections } = seedMissingSessions()

      const report = await migrateSigningGrants(database)

      expect(report.dryRun).toBe(true)
      expect(report.errors).toEqual([])
      expect(report.updated).toBe(2)
      expect(col(collections, SESSIONS).docs).toHaveLength(0)
    })

    it('migrate apply không ném và tạo đủ chỉ mục khi collection chưa có', async () => {
      const { database, collections } = seedMissingSessions()

      const report = await migrateSigningGrants(database, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(report.grants).toEqual({ source: 2, target: 2 })
      const target = col(collections, SESSIONS)
      expect(target.specs.has(SESSION_KIND_CONTRACT_INDEX)).toBe(true)
      expect(target.specs.has(GRANT_TOKEN_HASH_UNIQUE_INDEX)).toBe(true)
    })

    it('rollback dry-run và apply không ném khi collection phiên chưa có', async () => {
      const { database, collections } = seedMissingSessions()

      const dry = await rollbackSigningGrants(database)
      expect(dry).toMatchObject({ dryRun: true, errors: [] })

      const applied = await rollbackSigningGrants(database, { dryRun: false })
      expect(applied.errors).toEqual([])
      expect(col(collections, GRANTS).docs).toHaveLength(2)
      expect(
        col(collections, SESSIONS).specs.get('providerTransactionId_1')
      ).toEqual({
        name: 'providerTransactionId_1',
        key: LEGACY_PROVIDER_TX_INDEX_KEY,
        unique: true,
      })
    })
  })

  describe('rollback', () => {
    it('is a dry run by default and writes nothing', async () => {
      const { database, collections } = buildDatabase()
      seedClean(collections)
      await migrateSigningGrants(database, { dryRun: false })
      const before = JSON.stringify(col(collections, SESSIONS).docs)

      const report = await rollbackSigningGrants(database)

      expect(report).toMatchObject({ dryRun: true, errors: [] })
      expect(JSON.stringify(col(collections, SESSIONS).docs)).toBe(before)
    })

    it('restores grants written after the cutover, removes kind, and restores the legacy unique index', async () => {
      const { database, collections } = buildDatabase()
      seedClean(collections)
      await migrateSigningGrants(database, { dryRun: false })

      // Ghi sau chuyển code: đổi trạng thái grant A và thêm grant mới.
      const target = col(collections, SESSIONS)
      await target.updateOne({ _id: grantA }, { $set: { consumedAt: t(7) } })
      const newGrant = new ObjectId()
      target.insert({
        _id: newGrant,
        kind: 'grant',
        tokenHash: 'h-new',
        userId: 'u-5',
        role: 'tenant',
        contractId: 'c-5',
        contentLockedHash: 'lock-5',
        biometricGrantId: 'bio-5',
        otpSessionId: 'otp-5',
        expiresAt: t(9),
        consumedAt: null,
        createdAt: t(8),
      })

      const report = await rollbackSigningGrants(database, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(report.restored).toBe(3)
      const legacy = col(collections, GRANTS)
      expect(legacy.docs).toHaveLength(3)
      expect(legacy.docs.find(d => d._id.equals(grantA))?.consumedAt).toEqual(
        t(7)
      )
      const restoredNew = legacy.docs.find(d => d._id.equals(newGrant))
      expect(restoredNew).not.toHaveProperty('kind')
      expect(target.docs.some(d => d.kind === 'grant')).toBe(false)
      expect(target.docs.every(d => !('kind' in d))).toBe(true)
      expect(target.specs.has(SESSION_PROVIDER_TX_UNIQUE_INDEX)).toBe(false)
      expect(target.specs.has(GRANT_TOKEN_HASH_UNIQUE_INDEX)).toBe(false)
      expect(target.specs.get('providerTransactionId_1')).toEqual({
        name: 'providerTransactionId_1',
        key: LEGACY_PROVIDER_TX_INDEX_KEY,
        unique: true,
      })
    })

    it('keeps grant rows in the target when the legacy collection cannot hold them all', async () => {
      const { database, collections } = buildDatabase()
      seedClean(collections)
      await migrateSigningGrants(database, { dryRun: false })
      const legacy = col(collections, GRANTS)
      legacy.countDocuments = (): Promise<number> => Promise.resolve(0)

      const report = await rollbackSigningGrants(database, { dryRun: false })

      expect(report.errors).toHaveLength(1)
      expect(report.errors[0]).toContain('kind=grant kept')
      expect(
        col(collections, SESSIONS).docs.filter(d => d.kind === 'grant')
      ).toHaveLength(2)
      expect(
        col(collections, SESSIONS).docs.some(d => d.kind === 'session')
      ).toBe(true)
    })
  })
})
