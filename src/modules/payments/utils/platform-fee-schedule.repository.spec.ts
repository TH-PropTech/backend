import { ObjectId } from 'mongodb'
import type { MongoRepository } from 'typeorm'
import type { SystemConfig } from '../../properties/schemas/system-config.schema'
import { PlatformFeeScheduleRepository } from './platform-fee-schedule.repository'
import type { PlatformFeeScheduleRules } from './platform-fee.types'

type Row = Record<string, unknown> & { _id: ObjectId }

/** Bản giả của `Repository<SystemConfig>` cho find/findOne/create/save. */
class FakeSystemConfigRepo {
  rows: Row[] = []
  wheres: Record<string, unknown>[] = []

  private matches(row: Row, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([k, v]) => row[k] === v)
  }

  findOne(options: { where: Record<string, unknown> }): Promise<Row | null> {
    this.wheres.push(options.where)
    const row = this.rows.find(r => this.matches(r, options.where))
    return Promise.resolve(row ? { ...row } : null)
  }

  find(options: { where: Record<string, unknown> }): Promise<Row[]> {
    this.wheres.push(options.where)
    return Promise.resolve(
      this.rows.filter(r => this.matches(r, options.where)).map(r => ({ ...r }))
    )
  }

  create(value: Record<string, unknown>): Record<string, unknown> {
    return { ...value }
  }

  save(value: Record<string, unknown>): Promise<Row> {
    if (value._id) {
      const row = this.rows.find(r => r._id.equals(value._id as ObjectId))
      if (row) Object.assign(row, value)
      return Promise.resolve({ ...(row ?? value) } as Row)
    }
    const row = { ...value, _id: new ObjectId() } as Row
    this.rows.push(row)
    return Promise.resolve({ ...row })
  }
}

const RULES = { transactionTypes: {} } as unknown as PlatformFeeScheduleRules

function feeRow(overrides: Partial<Row> = {}): Row {
  return {
    _id: new ObjectId(),
    scope: 'platform-fee',
    key: 'fee-1@1',
    scheduleId: 'fee-1',
    version: 1,
    status: 'published',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    rules: RULES,
    legalReviewStatus: 'reviewed',
    reviewReference: 'LR-1',
    contentHash: 'h1',
    draftRevision: 2,
    createdBy: 'admin-1',
    publishedBy: 'admin-2',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2025-12-01T00:00:00Z'),
    updatedAt: new Date('2025-12-02T00:00:00Z'),
    ...overrides,
  }
}

/** Hàng không thuộc phí nhưng trùng `scheduleId/version/status` để thử phạm vi. */
function otherScopeRow(scope: string): Row {
  return {
    _id: new ObjectId(),
    scope,
    key: 'fee-1',
    scheduleId: 'fee-1',
    version: 1,
    status: 'published',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function facadeOver(fake: FakeSystemConfigRepo): PlatformFeeScheduleRepository {
  return new PlatformFeeScheduleRepository(
    fake as unknown as MongoRepository<SystemConfig>
  )
}

describe('PlatformFeeScheduleRepository (scope platform-fee trong system_configs)', () => {
  it('findOne: adds scope and ignores same scheduleId/version in other scopes', async () => {
    const fake = new FakeSystemConfigRepo()
    const fee = feeRow()
    fake.rows = [otherScopeRow('job'), otherScopeRow('groq-key'), fee]

    const found = await facadeOver(fake).findOne({
      where: { scheduleId: 'fee-1', version: 1 },
    })

    expect(fake.wheres[0]).toEqual({
      scope: 'platform-fee',
      scheduleId: 'fee-1',
      version: 1,
    })
    expect(found?._id).toEqual(fee._id)
    expect(found).not.toHaveProperty('scope')
    expect(found).not.toHaveProperty('key')
  })

  it('find: published filter returns only platform-fee rows', async () => {
    const fake = new FakeSystemConfigRepo()
    const fee = feeRow({ scheduleId: 'fee-2', version: 3 })
    fake.rows = [
      feeRow({ scheduleId: 'fee-old', key: 'fee-old@1', status: 'archived' }),
      fee,
      { ...otherScopeRow('job'), status: 'published' },
      { ...otherScopeRow('groq-key'), status: 'published' },
    ]

    const found = await facadeOver(fake).find({
      where: { status: 'published' },
    })

    expect(fake.wheres[0]).toEqual({
      scope: 'platform-fee',
      status: 'published',
    })
    expect(found.map(r => r.scheduleId)).toEqual(['fee-2'])
    expect(found[0]).not.toHaveProperty('scope')
  })

  it('save: writes scope and key scheduleId@version, returns the view without scope/key', async () => {
    const fake = new FakeSystemConfigRepo()
    const repo = facadeOver(fake)
    const draft = repo.create({
      scheduleId: 'fee-9',
      version: 4,
      status: 'draft',
      rules: RULES,
      legalReviewStatus: 'draft',
      reviewReference: null,
      contentHash: 'h9',
      draftRevision: 1,
      createdBy: 'admin-1',
    })

    const saved = await repo.save(draft)

    expect(fake.rows).toHaveLength(1)
    expect(fake.rows[0]).toMatchObject({
      scope: 'platform-fee',
      key: 'fee-9@4',
      scheduleId: 'fee-9',
      version: 4,
    })
    expect(saved).toMatchObject({
      scheduleId: 'fee-9',
      version: 4,
      status: 'draft',
      contentHash: 'h9',
    })
    expect(saved).not.toHaveProperty('scope')
    expect(saved).not.toHaveProperty('key')
  })

  it('save: updates an existing fee row without touching another scope', async () => {
    const fake = new FakeSystemConfigRepo()
    const other = otherScopeRow('job')
    const fee = feeRow({ status: 'published' })
    fake.rows = [other, fee]
    const repo = facadeOver(fake)

    const current = await repo.findOne({
      where: { scheduleId: 'fee-1', version: 1 },
    })
    await repo.save({ ...(current as object), status: 'archived' } as never)

    expect(fake.rows.find(r => r._id === fee._id)?.status).toBe('archived')
    expect(fake.rows.find(r => r._id === other._id)?.status).toBe('published')
  })
})
