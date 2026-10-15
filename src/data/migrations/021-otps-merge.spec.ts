import { ObjectId } from 'mongodb'
import {
  OTP_INDEXES,
  OTPS_MERGE_MIGRATION_ID,
  fromOtpDoc,
  migrateOtps,
  rollbackOtps,
  type OtpMongoCollection,
  type OtpMongoDatabase,
} from './021-otps-merge'

type Doc = Record<string, unknown> & { _id: ObjectId }

class FakeCollection implements OtpMongoCollection {
  docs: Doc[] = []
  indexes = new Map<string, Record<string, 1 | -1>>()

  private matches(doc: Doc, filter: Record<string, unknown> = {}): boolean {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in v) {
        return (v as { $in: ObjectId[] }).$in.some(x =>
          (doc[k] as ObjectId).equals(x)
        )
      }
      return v instanceof ObjectId
        ? (doc[k] as ObjectId).equals(v)
        : doc[k] === v
    })
  }

  find(filter?: Record<string, unknown>): { toArray(): Promise<Doc[]> } {
    return {
      toArray: () =>
        Promise.resolve(this.docs.filter(d => this.matches(d, filter))),
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
  ): Promise<{ upsertedCount?: number }> {
    if (this.docs.some(d => this.matches(d, filter)))
      return Promise.resolve({ upsertedCount: 0 })
    if (!options?.upsert) return Promise.resolve({ upsertedCount: 0 })
    this.docs.push({
      ...(filter as { _id: ObjectId }),
      ...(update.$setOnInsert as Record<string, unknown>),
    })
    return Promise.resolve({ upsertedCount: 1 })
  }

  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>
  ): Promise<{ matchedCount?: number }> {
    const index = this.docs.findIndex(d => this.matches(d, filter))
    if (index < 0) return Promise.resolve({ matchedCount: 0 })
    const current = this.docs[index] as Doc
    this.docs[index] = { _id: current._id, ...replacement }
    return Promise.resolve({ matchedCount: 1 })
  }

  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount?: number }> {
    const before = this.docs.length
    this.docs = this.docs.filter(d => !this.matches(d, filter))
    return Promise.resolve({ deletedCount: before - this.docs.length })
  }

  createIndex(
    keys: Record<string, 1 | -1>,
    options?: { name?: string }
  ): Promise<string> {
    const name = options?.name ?? JSON.stringify(keys)
    this.indexes.set(name, keys)
    return Promise.resolve(name)
  }

  dropIndex(name: string): Promise<unknown> {
    if (!this.indexes.delete(name)) return Promise.reject(new Error('no index'))
    return Promise.resolve()
  }
}

function buildDatabase(): {
  database: OtpMongoDatabase
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

const t = (n: number): Date => new Date(Date.UTC(2026, 0, n))

describe('021 otps merge migration', () => {
  let emailId: ObjectId
  let transactionId: ObjectId

  /**
   * Hai nguồn cùng `otpCode` '123456' và cùng `expiredAt`: mọi truy vấn không
   * lọc `kind` sẽ lẫn hai loại.
   */
  function seed(collections: Record<string, FakeCollection>): void {
    emailId = new ObjectId()
    transactionId = new ObjectId()
    collections.email_otps = new FakeCollection()
    col(collections, 'email_otps').docs.push({
      _id: emailId,
      email: 'a@x.vn',
      otpCode: '123456',
      action: 'signup',
      isUsed: false,
      expiredAt: t(5),
      createdAt: t(1),
      updatedAt: t(1),
    })
    collections.transaction_otps = new FakeCollection()
    col(collections, 'transaction_otps').docs.push({
      _id: transactionId,
      userId: 'user-1',
      deviceId: 'device-1',
      action: 'CONTRACT_SIGN',
      challenge: 'c-1',
      otpCode: '123456',
      status: 'INITIATED',
      attempts: 0,
      maxAttempts: 3,
      expiredAt: t(5),
      contractId: null,
      signerRole: null,
      contentLockedHash: null,
      contextHash: null,
      consumedAt: null,
      createdAt: t(2),
      updatedAt: t(2),
    })
  }

  describe('migrate', () => {
    it('is a dry run by default: reads and counts but writes nothing', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)

      const report = await migrateOtps(database)

      expect(report).toMatchObject({
        migrationId: OTPS_MERGE_MIGRATION_ID,
        dryRun: true,
        scanned: 2,
        updated: 2,
        skipped: 0,
        errors: [],
        counts: {
          email: { source: 1, target: 0 },
          transaction: { source: 1, target: 0 },
        },
      })
      expect(collections.otps?.docs ?? []).toEqual([])
    })

    it('copies by _id with kind, keeps every other field, verifies counts and creates the index', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)

      const report = await migrateOtps(database, { dryRun: false })

      const target = col(collections, 'otps')
      expect(target.docs).toHaveLength(2)
      const email = target.docs.find(d => d._id.equals(emailId))
      const transaction = target.docs.find(d => d._id.equals(transactionId))
      expect(email).toEqual({
        _id: emailId,
        kind: 'email',
        email: 'a@x.vn',
        otpCode: '123456',
        action: 'signup',
        isUsed: false,
        expiredAt: t(5),
        createdAt: t(1),
        updatedAt: t(1),
      })
      expect(transaction).toMatchObject({
        _id: transactionId,
        kind: 'transaction',
        userId: 'user-1',
        attempts: 0,
        maxAttempts: 3,
        contractId: null,
        consumedAt: null,
      })
      expect(transaction).not.toHaveProperty('email')
      expect(report.counts).toEqual({
        email: { source: 1, target: 1 },
        transaction: { source: 1, target: 1 },
      })
      expect(report.errors).toEqual([])
      expect(
        target.indexes.get('otps_kind_email_otp_code_action_used')
      ).toEqual({ kind: 1, email: 1, otpCode: 1, action: 1, isUsed: 1 })
    })

    it('is idempotent: running twice copies nothing the second time', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateOtps(database, { dryRun: false })

      const again = await migrateOtps(database, { dryRun: false })

      expect(again.updated).toBe(0)
      expect(again.skipped).toBe(2)
      expect(col(collections, 'otps').docs).toHaveLength(2)
    })

    it('refuses to apply (and writes nothing) when the same _id appears in both sources', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      const shared = new ObjectId()
      col(collections, 'email_otps').docs.push({
        _id: shared,
        email: 'b@x.vn',
        otpCode: '000001',
        action: 'login',
        isUsed: false,
        expiredAt: t(9),
      })
      col(collections, 'transaction_otps').docs.push({
        _id: shared,
        userId: 'user-2',
        otpCode: '000002',
        action: 'CONTRACT_SIGN',
        expiredAt: t(9),
      })

      await expect(migrateOtps(database, { dryRun: false })).rejects.toThrow(
        'refusing to apply'
      )
      expect(collections.otps?.docs ?? []).toEqual([])
    })

    it('refuses when an existing target row with the same _id has another kind', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      collections.otps = new FakeCollection()
      col(collections, 'otps').docs.push({
        _id: emailId,
        kind: 'transaction',
        otpCode: '999999',
        expiredAt: t(9),
      })

      await expect(migrateOtps(database, { dryRun: false })).rejects.toThrow(
        'refusing to apply'
      )
      expect(col(collections, 'otps').docs).toHaveLength(1)
    })

    it('throws when a source _id is missing from the target after writing', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      collections.otps = new FakeCollection()
      col(collections, 'otps').updateOne = (): Promise<{
        upsertedCount?: number
      }> => Promise.resolve({ upsertedCount: 0 })

      await expect(migrateOtps(database, { dryRun: false })).rejects.toThrow(
        'count mismatch for kind email'
      )
    })
  })

  describe('rollback', () => {
    async function migrated(): Promise<{
      database: OtpMongoDatabase
      collections: Record<string, FakeCollection>
    }> {
      const built = buildDatabase()
      seed(built.collections)
      await migrateOtps(built.database, { dryRun: false })
      return built
    }

    it('is a dry run by default and changes nothing', async () => {
      const { database, collections } = await migrated()

      const report = await rollbackOtps(database)

      expect(report.dryRun).toBe(true)
      expect(col(collections, 'otps').docs).toHaveLength(2)
      expect(col(collections, 'otps').indexes.size).toBe(1)
    })

    it('restores the legacy shape, then drops the rows and the index', async () => {
      const { database, collections } = await migrated()

      const report = await rollbackOtps(database, { dryRun: false })

      expect(report.errors).toEqual([])
      const email = col(collections, 'email_otps').docs.find(d =>
        d._id.equals(emailId)
      )
      expect(email).not.toHaveProperty('kind')
      expect(email).toMatchObject({ email: 'a@x.vn', isUsed: false })
      const transaction = col(collections, 'transaction_otps').docs.find(d =>
        d._id.equals(transactionId)
      )
      expect(transaction).not.toHaveProperty('kind')
      expect(transaction).not.toHaveProperty('email')
      expect(col(collections, 'otps').docs).toHaveLength(0)
      expect(col(collections, 'otps').indexes.size).toBe(0)
    })

    it('copies back changes and rows written after the code switch', async () => {
      const { database, collections } = await migrated()
      // Sau khi chuyển code: email được xác thực (isUsed), phiên giao dịch mới có null.
      const otps = col(collections, 'otps')
      const emailRow = otps.docs.find(d => d._id.equals(emailId)) as Doc
      emailRow.isUsed = true
      const newId = new ObjectId()
      otps.docs.push({
        _id: newId,
        kind: 'transaction',
        userId: 'user-9',
        deviceId: 'device-9',
        action: 'PIN_SETUP',
        challenge: 'c-9',
        otpCode: '424242',
        status: 'INITIATED',
        attempts: 0,
        maxAttempts: 3,
        expiredAt: t(20),
        email: null,
        isUsed: null,
        contractId: null,
      })

      const report = await rollbackOtps(database, { dryRun: false })

      expect(report.errors).toEqual([])
      const legacyEmail = col(collections, 'email_otps').docs.find(d =>
        d._id.equals(emailId)
      )
      expect(legacyEmail?.isUsed).toBe(true)
      const inserted = col(collections, 'transaction_otps').docs.find(d =>
        d._id.equals(newId)
      )
      expect(inserted).toMatchObject({
        userId: 'user-9',
        otpCode: '424242',
      })
      expect(inserted).not.toHaveProperty('kind')
      expect(inserted).not.toHaveProperty('email')
      expect(inserted).not.toHaveProperty('isUsed')
    })

    it('keeps the rows and the index when restoring fails the count check', async () => {
      const { database, collections } = await migrated()
      // Ghi ngược bị hỏng: bản ghi không về được collection cũ.
      col(collections, 'transaction_otps').replaceOne = (): Promise<{
        matchedCount?: number
      }> => Promise.resolve({ matchedCount: 0 })
      col(collections, 'transaction_otps').countDocuments =
        (): Promise<number> => Promise.resolve(0)

      const report = await rollbackOtps(database, { dryRun: false })

      expect(report.errors).toEqual([
        expect.stringContaining('transaction_otps: 0/1 rows restored'),
      ])
      expect(
        col(collections, 'otps')
          .docs.map(d => d.kind)
          .sort()
      ).toEqual(['transaction'])
      expect(col(collections, 'otps').indexes.size).toBe(1)
    })
  })

  it('declares the composite index used by the entity', () => {
    expect(OTP_INDEXES.map(i => i.name)).toEqual([
      'otps_kind_email_otp_code_action_used',
    ])
  })

  it('fromOtpDoc drops kind and other-kind nulls only', () => {
    const legacy = fromOtpDoc(
      {
        _id: new ObjectId(),
        kind: 'email',
        email: 'a@x.vn',
        isUsed: false,
        otpCode: '1',
        userId: null,
        attempts: undefined,
        contractId: null,
      },
      'email'
    )

    expect(legacy).toEqual({ email: 'a@x.vn', isUsed: false, otpCode: '1' })
  })
})
