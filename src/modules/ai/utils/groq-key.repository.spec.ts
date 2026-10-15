/* eslint-disable @typescript-eslint/explicit-function-return-type -- in-memory fakes */
import type { ConfigService } from '@nestjs/config'
import { ObjectId } from 'mongodb'
import type { MongoRepository } from 'typeorm'
import type { SystemConfig } from '../../properties/schemas/system-config.schema'
import { GroqKeysService } from '../services/groq-keys.service'
import { encrypt, keyHash } from './groq-key-crypto'
import { GroqKeyRepository } from './groq-key.repository'

const SECRET = 'a'.repeat(32)
const NOW = new Date('2026-01-01T00:00:00Z').getTime()

type Row = Record<string, unknown> & { _id: ObjectId }

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof ObjectId) {
    return actual instanceof ObjectId && actual.equals(expected)
  }
  if (expected && typeof expected === 'object' && '$lte' in expected) {
    return (actual as number) <= (expected as { $lte: number }).$lte
  }
  return actual === expected
}

/**
 * Bản giả của `MongoRepository<SystemConfig>` cho các thao tác GroqApiKey dùng.
 * `findOneAndUpdate` đọc-chọn-ghi trong một đoạn đồng bộ (không await giữa chừng),
 * mô phỏng một lệnh nguyên tử của MongoDB.
 */
class FakeSystemConfigRepo {
  rows: Row[] = []
  filters: Record<string, unknown>[] = []

  private matches(row: Row, filter: Record<string, unknown> = {}): boolean {
    return Object.entries(filter).every(([k, v]) => matchesValue(row[k], v))
  }

  private sorted(rows: Row[], sort?: Record<string, number>): Row[] {
    if (!sort) return rows
    const [field, dir] = Object.entries(sort)[0] as [string, number]
    return [...rows].sort((a, b) => {
      const av = (a[field] as Date).getTime()
      const bv = (b[field] as Date).getTime()
      return (av - bv) * dir
    })
  }

  private apply(row: Row, update: Record<string, unknown>): void {
    for (const [op, fields] of Object.entries(update)) {
      for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
        if (op === '$inc') row[k] = (row[k] as number) + (v as number)
        else row[k] = v
      }
    }
  }

  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { sort?: Record<string, number> }
  ): Promise<Row | null> {
    this.filters.push(filter)
    const [first] = this.sorted(
      this.rows.filter(r => this.matches(r, filter)),
      options?.sort
    )
    if (!first) return Promise.resolve(null)
    this.apply(first, update)
    return Promise.resolve({ ...first })
  }

  find(options: {
    where?: Record<string, unknown>
    order?: Record<string, 'ASC' | 'DESC'>
  }): Promise<Row[]> {
    this.filters.push(options.where ?? {})
    const order = options.order
      ? Object.fromEntries(
          Object.entries(options.order).map(([k, d]) => [
            k,
            d === 'DESC' ? -1 : 1,
          ])
        )
      : undefined
    return Promise.resolve(
      this.sorted(
        this.rows.filter(r => this.matches(r, options.where)),
        order
      ).map(r => ({ ...r }))
    )
  }

  findOneBy(where: Record<string, unknown>): Promise<Row | null> {
    this.filters.push(where)
    const row = this.rows.find(r => this.matches(r, where))
    return Promise.resolve(row ? { ...row } : null)
  }

  insert(entity: Row): Promise<void> {
    this.rows.push({ ...entity })
    return Promise.resolve()
  }

  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<void> {
    this.filters.push(filter)
    const row = this.rows.find(r => this.matches(r, filter))
    if (row) this.apply(row, update)
    return Promise.resolve()
  }

  deleteOne(filter: Record<string, unknown>): Promise<void> {
    this.filters.push(filter)
    const index = this.rows.findIndex(r => this.matches(r, filter))
    if (index >= 0) this.rows.splice(index, 1)
    return Promise.resolve()
  }
}

function groqRow(
  overrides: Partial<Row> & { keyRaw: string; createdAt: number }
): Row {
  const { keyRaw, createdAt, ...rest } = overrides
  return {
    _id: new ObjectId(),
    scope: 'groq-key',
    key: keyHash(keyRaw, SECRET),
    keyEnc: encrypt(keyRaw, SECRET),
    keyHash: keyHash(keyRaw, SECRET),
    keyMask: 'gsk_abcd...0123',
    status: 'active',
    cooldownUntil: 0,
    usageCount: 0,
    failCount: 0,
    lastUsedAt: 0,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    ...rest,
  }
}

/** Hàng `platform-fee` có trạng thái/giá trị trùng hình với khóa Groq để thử phạm vi. */
function feeRow(createdAt: number): Row {
  return {
    _id: new ObjectId(),
    scope: 'platform-fee',
    key: 'fee-1@1',
    scheduleId: 'fee-1',
    version: 1,
    status: 'active',
    cooldownUntil: 0,
    usageCount: 0,
    failCount: 0,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  }
}

function facadeOver(fake: FakeSystemConfigRepo): GroqKeyRepository {
  return new GroqKeyRepository(fake as unknown as MongoRepository<SystemConfig>)
}

function serviceOver(fake: FakeSystemConfigRepo): GroqKeysService {
  const config = { get: jest.fn().mockReturnValue(SECRET) }
  return new GroqKeysService(
    facadeOver(fake),
    config as unknown as ConfigService
  )
}

describe('GroqKeyRepository (scope groq-key trong system_configs)', () => {
  it('claim: every filter carries scope groq-key and skips other scopes', async () => {
    const fake = new FakeSystemConfigRepo()
    fake.rows = [
      feeRow(NOW - 1000),
      groqRow({ keyRaw: 'gsk_key_b', createdAt: NOW - 500 }),
    ]
    const repo = facadeOver(fake)

    const doc = await repo.findOneAndUpdate(
      { status: 'active', cooldownUntil: { $lte: NOW } },
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: NOW } },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    )

    expect(fake.filters[0]).toEqual({
      scope: 'groq-key',
      status: 'active',
      cooldownUntil: { $lte: NOW },
    })
    expect(doc?.keyHash).toBe(keyHash('gsk_key_b', SECRET))
    expect(doc?.usageCount).toBe(1)
    expect(doc?.createdAt).toBe(NOW - 500)
  })

  it('list: returns only groq rows, newest first, with numeric createdAt', async () => {
    const fake = new FakeSystemConfigRepo()
    fake.rows = [
      groqRow({ keyRaw: 'gsk_old', createdAt: NOW - 2000 }),
      feeRow(NOW - 1500),
      groqRow({ keyRaw: 'gsk_new', createdAt: NOW - 100 }),
    ]
    const docs = await facadeOver(fake).find({ order: { createdAt: 'DESC' } })

    expect(docs.map(d => d.keyHash)).toEqual([
      keyHash('gsk_new', SECRET),
      keyHash('gsk_old', SECRET),
    ])
    expect(typeof docs[0]?.createdAt).toBe('number')
    expect(docs[0]).not.toHaveProperty('scope')
  })

  it('findOneBy: does not return a row of another scope', async () => {
    const fake = new FakeSystemConfigRepo()
    const groq = groqRow({ keyRaw: 'gsk_x', createdAt: NOW })
    fake.rows = [feeRow(NOW), groq]

    const found = await facadeOver(fake).findOneBy({ _id: groq._id })
    expect(found?.keyHash).toBe(groq.keyHash)

    const other = fake.rows[0] as Row
    await expect(
      facadeOver(fake).findOneBy({ _id: other._id })
    ).resolves.toBeNull()
  })

  it('insert: writes scope groq-key, key = keyHash, createdAt as Date', async () => {
    const fake = new FakeSystemConfigRepo()
    const repo = facadeOver(fake)
    const entity = repo.create({
      keyEnc: 'enc',
      keyHash: 'h1',
      keyMask: 'm',
      status: 'active',
      cooldownUntil: 0,
      usageCount: 0,
      failCount: 0,
      lastUsedAt: 0,
      createdAt: NOW,
    })
    await repo.insert(entity)

    expect(fake.rows).toHaveLength(1)
    expect(fake.rows[0]).toMatchObject({
      scope: 'groq-key',
      key: 'h1',
      keyHash: 'h1',
      createdAt: new Date(NOW),
    })
  })

  it('updateOne: only touches the groq row even when a fee row shares the filter value', async () => {
    const fake = new FakeSystemConfigRepo()
    const fee = { ...feeRow(NOW), keyHash: 'shared' }
    const groq = groqRow({ keyRaw: 'gsk_u', createdAt: NOW })
    groq.keyHash = 'shared'
    fake.rows = [fee, groq]

    await facadeOver(fake).updateOne(
      { keyHash: 'shared' },
      { $set: { lastError: 'boom' }, $inc: { failCount: 1 } }
    )

    expect(fake.rows[0]).not.toHaveProperty('lastError')
    expect(fake.rows[1]).toMatchObject({ lastError: 'boom', failCount: 1 })
  })

  it('deleteOne: never deletes a row of another scope', async () => {
    const fake = new FakeSystemConfigRepo()
    const fee = feeRow(NOW)
    const groq = groqRow({ keyRaw: 'gsk_d', createdAt: NOW })
    fake.rows = [fee, groq]

    await facadeOver(fake).deleteOne({ _id: fee._id })
    expect(fake.rows).toHaveLength(2)

    await facadeOver(fake).deleteOne({ _id: groq._id })
    expect(fake.rows).toEqual([fee])
  })
})

describe('GroqKeysService claim tren system_configs', () => {
  it('concurrent current() claims: no lost increments, cooldown and other scopes ignored', async () => {
    const fake = new FakeSystemConfigRepo()
    const oldest = groqRow({
      keyRaw: 'gsk_first_key_0000000000000000',
      createdAt: NOW - 3,
    })
    const cooling = groqRow({
      keyRaw: 'gsk_cooling_key_00000000000000000',
      createdAt: NOW - 2,
      cooldownUntil: NOW + 60_000,
    })
    fake.rows = [feeRow(NOW - 4), oldest, cooling]
    const service = serviceOver(fake)

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.current())
    )

    // Claim giữ nguyên logic: luôn lấy khóa sẵn sàng cũ nhất (không đặt cooldown khi claim).
    expect(results).toEqual(Array(5).fill('gsk_first_key_0000000000000000'))
    const byRaw = (row: Row | undefined) => row?.usageCount
    expect(byRaw(fake.rows.find(r => r._id === oldest._id))).toBe(5)
    expect(byRaw(fake.rows.find(r => r._id === cooling._id))).toBe(0)
    expect(byRaw(fake.rows.find(r => r.scope === 'platform-fee'))).toBe(0)
  })
})
