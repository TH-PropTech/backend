import { ObjectId } from 'mongodb'
import type { Contract } from '../../contracts/schemas/contract.schema'
import { Payment } from '../schemas/payment.schema'
import { LatePenaltyService } from './late-penalty.service'

type Row = Record<string, unknown>

const CONTRACT_ID = new ObjectId().toHexString()

interface TestContext {
  service: LatePenaltyService
  rows: Payment[]
  paymentRepository: Record<'create' | 'save' | 'findOne' | 'find', jest.Mock>
  contractRepository: { findOne: jest.Mock }
  notificationsService: { createNotificationOnce: jest.Mock }
  ledgerOutboxService: { enqueue: jest.Mock }
}

function createContext(
  contractOverrides: Record<string, unknown> = {}
): TestContext {
  const rows: Payment[] = []
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, value]) =>
      key === '_id'
        ? (row._id as ObjectId).equals(value as ObjectId)
        : row[key] === value
    )
  const paymentRepository = {
    create: jest.fn(
      (value: Row): Payment =>
        ({ _id: new ObjectId(), ...value }) as unknown as Payment
    ),
    save: jest.fn((value: Payment): Promise<Payment> => {
      const index = rows.findIndex(row => row._id.equals(value._id))
      if (index >= 0) {
        rows[index] = value
        return Promise.resolve(value)
      }
      const clash = rows.find(
        row =>
          row.contractId === value.contractId &&
          row.type === value.type &&
          row.periodKey === value.periodKey
      )
      if (clash) {
        return Promise.reject(
          Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
        )
      }
      rows.push(value)
      return Promise.resolve(value)
    }),
    findOne: jest.fn(
      ({ where }: { where: Row }): Promise<Payment | null> =>
        Promise.resolve(
          rows.find(row => matches(row as unknown as Row, where)) ?? null
        )
    ),
    find: jest.fn(
      (): Promise<Payment[]> =>
        Promise.resolve(
          rows.filter(row => row.type === 'rent' && row.status === 'paid')
        )
    ),
  }
  const contract = {
    _id: new ObjectId(CONTRACT_ID),
    monthlyRent: 5_000_000,
    latePenaltyRate: 10,
    ...contractOverrides,
  } as unknown as Contract
  const contractRepository = {
    findOne: jest.fn().mockResolvedValue(contract),
  }
  const notificationsService = {
    createNotificationOnce: jest.fn().mockResolvedValue({}),
  }
  const ledgerOutboxService = { enqueue: jest.fn().mockResolvedValue({}) }
  const service = new LatePenaltyService(
    paymentRepository as never,
    contractRepository as never,
    notificationsService as never,
    ledgerOutboxService as never
  )
  return {
    service,
    rows,
    paymentRepository,
    contractRepository,
    notificationsService,
    ledgerOutboxService,
  }
}

function paidRent(overrides: Record<string, unknown> = {}): Payment {
  return {
    _id: new ObjectId(),
    contractId: CONTRACT_ID,
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    amount: 5_000_000,
    description: 'Rent 2026-11',
    dueDate: new Date('2026-11-05T00:00:00+07:00'),
    paidAt: new Date('2026-11-25T10:00:00+07:00'),
    status: 'paid',
    type: 'rent',
    periodKey: '2026-11',
    txHash: null,
    ...overrides,
  } as unknown as Payment
}

describe('LatePenaltyService.assessForPaidRent', () => {
  it('creates one penalty invoice for a rent invoice paid 20 days late', async () => {
    const ctx = createContext()
    const source = paidRent()

    const penalty = await ctx.service.assessForPaidRent(source)

    expect(penalty).toMatchObject({
      type: 'penalty',
      status: 'unpaid',
      amount: 27_397,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      payerRole: 'tenant',
      payeeRole: 'landlord',
      sourcePaymentId: source._id.toHexString(),
      periodKey: `late-${source._id.toHexString()}`,
      latePenalty: {
        baseAmount: 5_000_000,
        ratePerYear: 10,
        daysLate: 20,
        dueDateKey: '2026-11-05',
        paidDateKey: '2026-11-25',
      },
    })
    // Due 7 days after the source payment date (2026-11-25 + 7 = 2026-12-02).
    expect(penalty?.dueDate.toISOString()).toBe(
      new Date('2026-12-02T10:00:00+07:00').toISOString()
    )
    expect(penalty?.assessmentEvidence).toMatchObject({
      ledgerStatus: 'pending',
      txHash: null,
    })
  })

  it('anchors the penalty after the source payment, waiting for ABI 3', async () => {
    const ctx = createContext()
    const source = paidRent()
    const penalty = await ctx.service.assessForPaidRent(source)

    expect(ctx.ledgerOutboxService.enqueue).toHaveBeenCalledTimes(1)
    const event = ctx.ledgerOutboxService.enqueue.mock.calls[0]?.[0] as {
      aggregateType: string
      aggregateId: string
      eventType: string
      action: string
      args: string[]
      dependencyKey: string
      metadata: Record<string, unknown>
    }
    expect(event).toMatchObject({
      aggregateType: 'penalty',
      aggregateId: penalty?._id.toHexString(),
      eventType: 'penalty.assessed',
      action: 'recordPenalty',
      dependencyKey: `payment:${source._id.toHexString()}:payment.paid`,
      metadata: {
        minimumAbiVersion: 3,
        waitingCode: 'CHAINCODE_UPGRADE_REQUIRED',
      },
    })
    expect(event.args.slice(0, 7)).toEqual([
      penalty?._id.toHexString(),
      CONTRACT_ID,
      source._id.toHexString(),
      '5000000',
      '10',
      '20',
      '27397',
    ])
    expect(event.args[7]).toBe(penalty?.assessmentEvidence?.manifestHash)
    expect(event.args[7]).toMatch(/^[a-f0-9]{64}$/)
  })

  it('notifies both parties with the amount, calculation and due date', async () => {
    const ctx = createContext()
    await ctx.service.assessForPaidRent(paidRent())

    const calls = ctx.notificationsService.createNotificationOnce.mock
      .calls as Array<[string, string, string, string, string]>
    expect(calls.map(call => call[0]).sort()).toEqual([
      'landlord-1',
      'tenant-1',
    ])
    for (const call of calls) {
      expect(call[4]).toBe('LATE_PENALTY_ASSESSED')
      expect(call[3]).toContain('27.397')
      expect(call[3]).toContain('20 ngày')
    }
  })

  it('creates nothing when paid on the due date', async () => {
    const ctx = createContext()
    const result = await ctx.service.assessForPaidRent(
      paidRent({ paidAt: new Date('2026-11-05T23:30:00+07:00') })
    )
    expect(result).toBeNull()
    expect(ctx.rows).toHaveLength(0)
    expect(ctx.ledgerOutboxService.enqueue).not.toHaveBeenCalled()
  })

  it('creates nothing when an admin-template contract has a 0 rate', async () => {
    const ctx = createContext({
      latePenaltyRate: 0,
      contractTemplateRef: { key: 'VN_LEASE', version: 1 },
    })
    expect(await ctx.service.assessForPaidRent(paidRent())).toBeNull()
    expect(ctx.rows).toHaveLength(0)
  })

  it('applies the 10% fallback printed by the built-in layout when the rate is 0', async () => {
    const ctx = createContext({ latePenaltyRate: 0 })
    const penalty = await ctx.service.assessForPaidRent(paidRent())
    expect(penalty?.latePenalty?.ratePerYear).toBe(10)
    expect(penalty?.amount).toBe(27_397)
  })

  it('creates nothing when the rounded amount is 0', async () => {
    const ctx = createContext()
    expect(
      await ctx.service.assessForPaidRent(paidRent({ amount: 10 }))
    ).toBeNull()
  })

  it('returns the same invoice on a repeated confirmation and does not notify or anchor twice', async () => {
    const ctx = createContext()
    const source = paidRent()
    const first = await ctx.service.assessForPaidRent(source)
    const second = await ctx.service.assessForPaidRent(source)

    expect(second).toBe(first)
    expect(ctx.rows.filter(row => row.type === 'penalty')).toHaveLength(1)
    expect(ctx.ledgerOutboxService.enqueue).toHaveBeenCalledTimes(1)
    expect(
      ctx.notificationsService.createNotificationOnce
    ).toHaveBeenCalledTimes(2)
  })

  it('treats a duplicate-key race as already assessed', async () => {
    const ctx = createContext()
    const source = paidRent()
    const winner = {
      _id: new ObjectId(),
      contractId: CONTRACT_ID,
      type: 'penalty',
      periodKey: `late-${source._id.toHexString()}`,
    } as unknown as Payment
    // The first lookup misses, then the concurrent writer wins the unique key.
    ctx.paymentRepository.findOne.mockResolvedValueOnce(null)
    ctx.paymentRepository.save.mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
    )
    ctx.paymentRepository.findOne.mockResolvedValueOnce(winner)

    const result = await ctx.service.assessForPaidRent(source)

    expect(result).toBe(winner)
    expect(ctx.ledgerOutboxService.enqueue).not.toHaveBeenCalled()
    expect(
      ctx.notificationsService.createNotificationOnce
    ).not.toHaveBeenCalled()
  })

  it.each(['penalty', 'deposit', 'deposit-topup', 'platform-fee'] as const)(
    'never assesses interest on a late %s invoice',
    async type => {
      const ctx = createContext()
      expect(await ctx.service.assessForPaidRent(paidRent({ type }))).toBeNull()
      expect(ctx.rows).toHaveLength(0)
    }
  )

  it('does not assess an invoice that is not paid', async () => {
    const ctx = createContext()
    expect(
      await ctx.service.assessForPaidRent(paidRent({ status: 'overdue' }))
    ).toBeNull()
  })

  it('still creates the invoice when the ledger outbox is unavailable', async () => {
    const ctx = createContext()
    Reflect.set(ctx.service, 'ledgerOutboxService', undefined)
    const penalty = await ctx.service.assessForPaidRent(paidRent())
    expect(penalty?.amount).toBe(27_397)
  })
})

describe('LatePenaltyService.assessMissing', () => {
  it('creates the missing penalty once and skips invoices that already have one', async () => {
    const ctx = createContext()
    const late = paidRent()
    const alreadyAssessed = paidRent({ periodKey: '2026-10' })
    ctx.rows.push(late, alreadyAssessed)
    ctx.rows.push({
      _id: new ObjectId(),
      contractId: CONTRACT_ID,
      type: 'penalty',
      periodKey: `late-${alreadyAssessed._id.toHexString()}`,
    } as unknown as Payment)

    expect(
      await ctx.service.assessMissing(new Date('2026-11-26T00:00:00Z'))
    ).toBe(1)
    expect(
      await ctx.service.assessMissing(new Date('2026-11-26T00:00:00Z'))
    ).toBe(0)
    expect(ctx.rows.filter(row => row.type === 'penalty')).toHaveLength(2)
  })

  it('keeps sweeping when one invoice fails', async () => {
    const ctx = createContext()
    ctx.rows.push(paidRent({ periodKey: '2026-09' }), paidRent())
    ctx.contractRepository.findOne.mockRejectedValueOnce(new Error('db down'))

    expect(
      await ctx.service.assessMissing(new Date('2026-11-26T00:00:00Z'))
    ).toBe(1)
  })
})
