/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/explicit-function-return-type -- fake Mongo in-memory (giống 007-021) */
import { ObjectId } from 'mongodb'
import {
  KYC_RECORDS_EMBED_MIGRATION_ID,
  migrateKycRecordsToUsers,
  rollbackKycRecordsEmbed,
  type KycEmbedMigrationDb,
} from './026-kyc-records-embed'

type Doc = Record<string, any>

/* ---------- DB giả: đủ toán tử migration dùng (equality, $in, $exists, $ne, $or, $set, $unset) ---------- */

function getPath(doc: Doc, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Doc)[key] : undefined,
      doc
    )
}

function hex(value: unknown): string | undefined {
  if (value instanceof ObjectId) return value.toHexString()
  return typeof value === 'string' ? value : undefined
}

function same(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a instanceof ObjectId || b instanceof ObjectId) {
    return hex(a) === hex(b)
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }
  return a === b
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return (expected as Doc[]).some(sub => matches(doc, sub))
    }
    const actual = getPath(doc, key)
    if (
      expected &&
      typeof expected === 'object' &&
      !(expected instanceof ObjectId) &&
      !(expected instanceof Date)
    ) {
      const ops = expected as Doc
      if ('$in' in ops) {
        return (ops.$in as unknown[]).some(value => same(actual, value))
      }
      if ('$exists' in ops) {
        return (actual !== undefined) === Boolean(ops.$exists)
      }
      if ('$ne' in ops) {
        return !same(actual, ops.$ne)
      }
    }
    if (expected === null) return actual === null || actual === undefined
    return same(actual, expected)
  })
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const keys = path.split('.')
  let node = doc
  for (const key of keys.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[keys[keys.length - 1] as string] = value
}

function unsetPath(doc: Doc, path: string): void {
  const keys = path.split('.')
  let node: Doc | undefined = doc
  for (const key of keys.slice(0, -1)) {
    node = node?.[key]
  }
  if (node) delete node[keys[keys.length - 1] as string]
}

export class FakeDb implements KycEmbedMigrationDb {
  readonly data: Record<string, Doc[]>
  readonly log: string[] = []
  readonly indexes = new Map<string, Record<string, unknown>>()
  /** Chèn lỗi có chủ đích: tên collection -> hàm ném lỗi theo tài liệu. */
  failReplace: ((doc: Doc) => Error | null) | null = null
  countOverride: number | null = null

  constructor(data: Record<string, Doc[]>) {
    this.data = data
    for (const name of ['users', 'kyc_records']) this.data[name] ??= []
  }

  collection(name: string): any {
    const rows = (): Doc[] => (this.data[name] ??= [])
    return {
      find: (filter: Doc = {}) => ({
        toArray: async () =>
          rows()
            .filter(doc => matches(doc, filter))
            .map(d => ({ ...d })),
      }),
      countDocuments: async (filter: Doc = {}) => {
        this.log.push(`count:${name}`)
        if (this.countOverride !== null && name === 'users')
          return this.countOverride
        return rows().filter(doc => matches(doc, filter)).length
      },
      updateOne: async (filter: Doc, update: Doc) => {
        this.log.push(`updateOne:${name}`)
        const doc = rows().find(d => matches(d, filter))
        if (!doc) return { matchedCount: 0 }
        for (const [key, value] of Object.entries(update.$set ?? {}))
          setPath(doc, key, value)
        for (const key of Object.keys(update.$unset ?? {})) unsetPath(doc, key)
        return { matchedCount: 1 }
      },
      replaceOne: async (
        filter: Doc,
        replacement: Doc,
        options: { upsert?: boolean } = {}
      ) => {
        this.log.push(`replaceOne:${name}`)
        const error = this.failReplace?.(replacement) ?? null
        if (error) throw error
        const list = rows()
        const index = list.findIndex(d => matches(d, filter))
        if (index >= 0) {
          list[index] = { ...replacement }
          return { matchedCount: 1 }
        }
        if (options.upsert) list.push({ ...replacement })
        return { matchedCount: 0 }
      },
      createIndex: async (keys: Doc, options: Doc = {}) => {
        this.log.push(`createIndex:${options.name}`)
        this.indexes.set(options.name, { keys, ...options })
        return options.name
      },
      dropIndex: async (name: string) => {
        this.log.push(`dropIndex:${name}`)
        if (!this.indexes.has(name))
          throw new Error(`index not found with name [${name}]`)
        this.indexes.delete(name)
      },
    }
  }
}

/* ---------- Dữ liệu mẫu ---------- */

const U1 = new ObjectId('64b000000000000000000001')
const U2 = new ObjectId('64b000000000000000000002')
const R1 = new ObjectId('64c000000000000000000001')
const R2 = new ObjectId('64c000000000000000000002')
const R3 = new ObjectId('64c000000000000000000003')

function user(id: ObjectId, extra: Doc = {}): Doc {
  return {
    _id: id,
    email: `${String(id)}@x.test`,
    phone: `09${String(id).slice(-8)}`,
    kycStatus: 'pending',
    ...extra,
  }
}

function record(id: ObjectId, userId: unknown, extra: Doc = {}): Doc {
  return {
    _id: id,
    userId,
    idCardNumber: '079123456789',
    frontCardUrl: 'kyc-media:f',
    backCardUrl: 'kyc-media:b',
    selfieUrl: 'kyc-media:s',
    fullName: 'NGUYEN VAN A',
    status: 'pending',
    rejectedReason: null,
    verifiedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-02T00:00:00Z'),
    ...extra,
  }
}

const ID = KYC_RECORDS_EMBED_MIGRATION_ID

describe('026-kyc-records-embed: migrate', () => {
  it('chạy thử mặc định: không ghi, không tạo chỉ mục', async () => {
    const db = new FakeDb({
      users: [user(U1)],
      kyc_records: [record(R1, U1.toHexString())],
    })

    const report = await migrateKycRecordsToUsers(db)

    expect(report.dryRun).toBe(true)
    expect(report.migrationId).toBe(ID)
    expect(report.embedded).toBe(1)
    expect(db.data.users?.[0]?.kyc).toBeUndefined()
    expect(
      db.log.some(
        entry =>
          entry.startsWith('updateOne') || entry.startsWith('createIndex')
      )
    ).toBe(false)
  })

  it('nhúng hồ sơ vào users.kyc giữ _id cũ làm recordId, bỏ userId, giữ mọi trường', async () => {
    const db = new FakeDb({
      users: [user(U1)],
      kyc_records: [record(R1, U1.toHexString(), { legacyNote: 'giữ nguyên' })],
    })

    const report = await migrateKycRecordsToUsers(db, { dryRun: false })

    const kyc = db.data.users?.[0]?.kyc
    expect(kyc.recordId).toEqual(R1)
    expect(kyc.userId).toBeUndefined()
    expect(kyc.legacyNote).toBe('giữ nguyên')
    expect(kyc.idCardNumber).toBe('079123456789')
    expect(kyc.status).toBe('pending')
    expect(report.dryRun).toBe(false)
    expect(report.expectedEmbedded).toBe(1)
    expect(report.verifiedEmbedded).toBe(1)
    expect(report.errors).toEqual([])
  })

  it('idempotent: chạy lần hai không ghi gì thêm và vẫn kiểm đếm đúng', async () => {
    const db = new FakeDb({
      users: [user(U1)],
      kyc_records: [record(R1, U1.toHexString())],
    })
    await migrateKycRecordsToUsers(db, { dryRun: false })
    db.log.length = 0

    const second = await migrateKycRecordsToUsers(db, { dryRun: false })

    expect(second.embedded).toBe(0)
    expect(second.skipped).toBe(1)
    expect(second.verifiedEmbedded).toBe(1)
    expect(db.log).not.toContain('updateOne:users')
  })

  it('bản ghi mồ côi (userId lạ hoặc không còn user) được giữ lại và báo cáo, không ném lỗi', async () => {
    const db = new FakeDb({
      users: [user(U1)],
      kyc_records: [
        record(R1, U1.toHexString()),
        record(R2, new ObjectId('64b0000000000000000000ff').toHexString()),
        record(R3, 'không-phải-id'),
      ],
    })

    const report = await migrateKycRecordsToUsers(db, { dryRun: false })

    expect(report.orphans).toHaveLength(2)
    expect(report.embedded).toBe(1)
    expect(db.data.kyc_records).toHaveLength(3) // nguồn không bị xóa
    expect(db.data.users?.[0]?.kyc?.recordId).toEqual(R1)
  })

  it('nhiều hồ sơ cùng user (không có unique ở nguồn): nhúng bản mới nhất, bản cũ giữ nguyên trong kyc_records', async () => {
    const db = new FakeDb({
      users: [user(U1)],
      kyc_records: [
        record(R1, U1.toHexString(), {
          createdAt: new Date('2026-09-01T00:00:00Z'),
        }),
        record(R2, U1.toHexString(), {
          createdAt: new Date('2026-09-05T00:00:00Z'),
          status: 'verified',
        }),
      ],
    })

    const report = await migrateKycRecordsToUsers(db, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(db.data.users?.[0]?.kyc?.recordId).toEqual(R2)
    expect(db.data.users?.[0]?.kyc?.status).toBe('verified')
    expect(report.superseded).toEqual([String(R1)])
    expect(db.data.kyc_records).toHaveLength(2)
  })

  it('hồ sơ thiếu trường bắt buộc vẫn được nhúng phần có sẵn, báo cáo incomplete', async () => {
    const broken = record(R1, U1.toHexString())
    delete broken.status
    delete broken.frontCardUrl
    const db = new FakeDb({ users: [user(U1)], kyc_records: [broken] })

    const report = await migrateKycRecordsToUsers(db, { dryRun: false })

    expect(report.incomplete).toEqual([`${String(R1)}:status,frontCardUrl`])
    expect(db.data.users?.[0]?.kyc?.recordId).toEqual(R1)
    expect(db.data.users?.[0]?.kyc?.frontCardUrl).toBeUndefined()
    expect(db.data.users?.[0]?.kyc?.createdAt).toBeInstanceOf(Date)
    expect(report.errors).toEqual([])
  })

  it('userId lưu dạng ObjectId (dữ liệu bẩn) vẫn khớp đúng user', async () => {
    const db = new FakeDb({
      users: [user(U1)],
      kyc_records: [record(R1, U1)],
    })

    await migrateKycRecordsToUsers(db, { dryRun: false })

    expect(db.data.users?.[0]?.kyc?.recordId).toEqual(R1)
  })

  it('user đã có kyc với recordId khác: không ghi đè, báo xung đột, nguồn giữ nguyên', async () => {
    const db = new FakeDb({
      users: [user(U1, { kyc: { recordId: R3, status: 'verified' } })],
      kyc_records: [record(R1, U1.toHexString())],
    })

    const report = await migrateKycRecordsToUsers(db, { dryRun: false })

    expect(report.conflicts).toEqual([String(R1)])
    expect(db.data.users?.[0]?.kyc?.recordId).toEqual(R3)
    expect(db.data.kyc_records).toHaveLength(1)
  })

  it('báo cáo lệch kycStatus nhưng không tự sửa', async () => {
    const db = new FakeDb({
      users: [user(U1, { kycStatus: 'not-started' })],
      kyc_records: [record(R1, U1.toHexString())],
    })

    const report = await migrateKycRecordsToUsers(db, { dryRun: false })

    expect(report.statusMismatch).toEqual([U1.toHexString()])
    expect(db.data.users?.[0]?.kycStatus).toBe('not-started')
  })

  it('kiểm đếm lệch thì ném lỗi và KHÔNG tạo chỉ mục', async () => {
    const db = new FakeDb({
      users: [user(U1)],
      kyc_records: [record(R1, U1.toHexString())],
    })
    db.countOverride = 0

    await expect(
      migrateKycRecordsToUsers(db, { dryRun: false })
    ).rejects.toThrow(/count mismatch/)
    expect(db.indexes.size).toBe(0)
  })

  it('tạo chỉ mục SAU khi kiểm đếm thỏa', async () => {
    const db = new FakeDb({
      users: [user(U1)],
      kyc_records: [record(R1, U1.toHexString())],
    })

    const report = await migrateKycRecordsToUsers(db, { dryRun: false })

    const countAt = db.log.indexOf('count:users')
    const firstIndexAt = db.log.findIndex(entry =>
      entry.startsWith('createIndex:')
    )
    expect(countAt).toBeGreaterThanOrEqual(0)
    expect(firstIndexAt).toBeGreaterThan(countAt)
    expect(db.indexes.has('kyc_status_1_kyc_createdAt_-1')).toBe(true)
    expect(db.indexes.has('kyc_recordId_1')).toBe(true)
    expect(report.indexes).toEqual(
      expect.arrayContaining([
        'kyc_status_1_kyc_createdAt_-1',
        'kyc_recordId_1',
      ])
    )
  })

  it('không có dữ liệu thì không lỗi', async () => {
    const db = new FakeDb({ users: [], kyc_records: [] })

    const report = await migrateKycRecordsToUsers(db, { dryRun: false })

    expect(report.scanned).toBe(0)
    expect(report.errors).toEqual([])
  })
})

describe('026-kyc-records-embed: rollback', () => {
  it('chạy thử mặc định: không ghi', async () => {
    const db = new FakeDb({
      users: [
        user(U1, {
          kyc: {
            recordId: R1,
            status: 'pending',
            idCardNumber: 'x',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      ],
      kyc_records: [],
    })

    const report = await rollbackKycRecordsEmbed(db)

    expect(report.dryRun).toBe(true)
    expect(report.updated).toBe(1)
    expect(db.data.kyc_records).toHaveLength(0)
    expect(db.data.users?.[0]?.kyc).toBeDefined()
  })

  it('sao ngược cả bản đã sửa sau chuyển code và bản tạo mới, rồi bỏ kyc và chỉ mục', async () => {
    const db = new FakeDb({
      users: [
        user(U1, {
          kyc: {
            recordId: R1,
            userId: undefined,
            status: 'verified',
            idCardNumber: 'sửa-sau-chuyển',
            createdAt: new Date('2026-09-01'),
            updatedAt: new Date('2026-09-10'),
            verifiedAt: new Date('2026-09-10'),
            rejectedReason: null,
          },
        }),
        user(U2, {
          kyc: {
            recordId: R2,
            status: 'pending',
            idCardNumber: 'mới',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      ],
      kyc_records: [
        record(R1, U1.toHexString(), { createdAt: new Date('2026-09-01') }),
      ],
    })
    db.indexes.set('kyc_status_1_kyc_createdAt_-1', {})
    db.indexes.set('kyc_recordId_1', {})

    const report = await rollbackKycRecordsEmbed(db, { dryRun: false })

    expect(report.errors).toEqual([])
    const restored = db.data.kyc_records!.find(
      r => String(r._id) === String(R1)
    )
    expect(restored?.idCardNumber).toBe('sửa-sau-chuyển')
    expect(restored?.userId).toBe(U1.toHexString())
    expect(
      db.data.kyc_records!.find(r => String(r._id) === String(R2))?.userId
    ).toBe(U2.toHexString())
    expect(db.data.users?.every(u => u.kyc === undefined)).toBe(true)
    expect(db.indexes.size).toBe(0)
  })

  it('lỗi sao ngược một hồ sơ thì giữ kyc của user đó và không bỏ chỉ mục', async () => {
    const db = new FakeDb({
      users: [
        user(U1, {
          kyc: {
            recordId: R1,
            status: 'pending',
            idCardNumber: 'x',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      ],
      kyc_records: [],
    })
    db.failReplace = () => new Error('disk full')
    db.indexes.set('kyc_recordId_1', {})

    const report = await rollbackKycRecordsEmbed(db, { dryRun: false })

    expect(report.errors.length).toBeGreaterThan(0)
    expect(db.data.users?.[0]?.kyc).toBeDefined()
    expect(db.indexes.has('kyc_recordId_1')).toBe(true)
  })
})
