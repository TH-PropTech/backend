import { ObjectId } from 'mongodb'
import { AdminPaymentsService } from './admin-payments.service'
import type { PaymentAttempt } from './../schemas/payment-attempt.schema'
import type { Payment } from './../schemas/payment.schema'
import type { Payout } from '../../wallets/schemas/payout.schema'
import type { User } from '../../users/schemas/user.schema'

type Mocks<K extends string> = Record<K, jest.Mock>

const PAY_ID = '507f1f77bcf86cd799439011'
const DEP_ID = '507f191e810c19729de860ea'

function makeAttempt(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  const now = new Date()
  return {
    _id: new ObjectId(),
    provider: 'momo',
    txRef: 'TX-1',
    paymentId: PAY_ID,
    paymentIds: null,
    contractId: 'c-1',
    paymentType: 'rent',
    userId: 'tenant-1',
    amount: 5_000_000,
    status: 'succeeded',
    expiresAt: now,
    processedAt: now,
    callbackDigest: null,
    providerPaymentUrl: null,
    providerTransactionId: 'gw-1',
    clientChannel: 'web',
    payeeAccountNumber: null,
    momoMethod: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    _id: new ObjectId(PAY_ID),
    contractId: 'c-1',
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    amount: 5_000_000,
    description: 'Tiền thuê tháng 1',
    dueDate: new Date(),
    paidAt: new Date(),
    status: 'paid',
    txHash: null,
    type: 'rent',
    payeeRole: 'landlord',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makePayout(overrides: Partial<Payout> = {}): Payout {
  return {
    _id: new ObjectId(),
    paymentId: PAY_ID,
    contractId: 'c-1',
    landlordId: 'landlord-1',
    walletId: null,
    txRef: 'PAYOUT-1',
    sentAmount: 5_000_000,
    feeAmount: 0,
    receivedAmount: 5_000_000,
    status: 'paid-out',
    attempts: 1,
    failureReason: null,
    paidOutAt: new Date(),
    directReceipt: false,
    relayRef: 'MOCBANK-TX-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    _id: new ObjectId(),
    fullName: 'Nguyễn Văn A',
    email: 'a@example.com',
    ...overrides,
  } as User
}

function setup(): {
  service: AdminPaymentsService
  attempts: Mocks<'find' | 'findOne' | 'findAndCount' | 'updateOne'>
  registry: { getForQuery: jest.Mock }
  queryStatus: jest.Mock
  payments: Mocks<'find'>
  deposits: Mocks<'find'>
  payouts: Mocks<'find'>
  users: Mocks<'find'>
} {
  const attempts = {
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  }
  const queryStatus = jest.fn()
  const registry = {
    getForQuery: jest.fn().mockReturnValue({ name: 'momo', queryStatus }),
  }
  const payments = { find: jest.fn() }
  const deposits = { find: jest.fn() }
  const payouts = { find: jest.fn() }
  const users = { find: jest.fn() }
  const service = new AdminPaymentsService(
    attempts as never,
    payments as never,
    deposits as never,
    payouts as never,
    users as never,
    registry as never
  )
  return {
    service,
    attempts,
    payments,
    deposits,
    payouts,
    users,
    registry,
    queryStatus,
  }
}

describe('AdminPaymentsService.list', () => {
  it('joins attempt, payment, payout and user into one row', async () => {
    const { service, attempts, payments, deposits, payouts, users } = setup()
    attempts.findAndCount.mockResolvedValue([[makeAttempt()], 1])
    payments.find.mockResolvedValue([makePayment()])
    deposits.find.mockResolvedValue([])
    payouts.find.mockResolvedValue([makePayout()])
    users.find.mockResolvedValue([
      makeUser({ _id: new ObjectId(), fullName: 'Khách thuê' }),
      makeUser({ fullName: 'Chủ nhà' }),
    ])

    const page = await service.list({})

    expect(page.total).toBe(1)
    expect(page.items).toHaveLength(1)
    const row = page.items[0]!
    expect(row.txRef).toBe('TX-1')
    expect(row.provider).toBe('momo')
    expect(row.payeeRole).toBe('landlord')
    expect(row.paymentStatus).toBe('paid')
    expect(row.payout?.status).toBe('paid-out')
    expect(row.payout?.relayRef).toBe('MOCBANK-TX-1')
    expect(row.payout?.settlement).toBe('relay')
    // Legacy attempt (no reconcile columns) reads as unverified, no live call.
    expect(row.gateway).toEqual({
      kind: 'external',
      reconcileStatus: 'unverified',
      gatewayStatus: null,
      providerTransactionId: 'gw-1',
      checkedAt: null,
    })
    expect(row.anomalies).toContain('awaiting-reconciliation')
  })

  it('flags a paid payment with no payout row', async () => {
    const { service, attempts, payments, deposits, payouts, users } = setup()
    attempts.findAndCount.mockResolvedValue([[makeAttempt()], 1])
    payments.find.mockResolvedValue([makePayment()])
    deposits.find.mockResolvedValue([])
    payouts.find.mockResolvedValue([])
    users.find.mockResolvedValue([])

    const page = await service.list({})

    expect(page.items[0]!.anomalies).toContain('paid-without-payout')
  })

  it('flags a succeeded attempt whose payment is still unpaid', async () => {
    const { service, attempts, payments, deposits, payouts, users } = setup()
    attempts.findAndCount.mockResolvedValue([[makeAttempt()], 1])
    payments.find.mockResolvedValue([
      makePayment({ status: 'unpaid', paidAt: null }),
    ])
    deposits.find.mockResolvedValue([])
    payouts.find.mockResolvedValue([])
    users.find.mockResolvedValue([])

    const page = await service.list({})

    expect(page.items[0]!.anomalies).toContain(
      'attempt-succeeded-payment-not-paid'
    )
  })

  it('flags a failed payout', async () => {
    const { service, attempts, payments, deposits, payouts, users } = setup()
    attempts.findAndCount.mockResolvedValue([[makeAttempt()], 1])
    payments.find.mockResolvedValue([makePayment()])
    deposits.find.mockResolvedValue([])
    payouts.find.mockResolvedValue([
      makePayout({ status: 'failed', failureReason: 'GATEWAY_UNAVAILABLE' }),
    ])
    users.find.mockResolvedValue([])

    const page = await service.list({})

    expect(page.items[0]!.anomalies).toContain('payout-failed')
    expect(page.items[0]!.payout?.failureReason).toBe('GATEWAY_UNAVAILABLE')
  })

  it('short-circuits to an empty page when payoutStatus matches no payout', async () => {
    const { service, attempts, payouts } = setup()
    payouts.find.mockResolvedValue([])

    const page = await service.list({ payoutStatus: 'failed' })

    expect(page).toEqual({ items: [], total: 0, page: 1, limit: 20 })
    expect(attempts.findAndCount).not.toHaveBeenCalled()
  })

  it('resolves the landlord via DepositAgreement when the attempt is a deposit', async () => {
    const { service, attempts, payments, deposits, payouts, users } = setup()
    attempts.findAndCount.mockResolvedValue([
      [makeAttempt({ paymentType: 'deposit', paymentId: DEP_ID })],
      1,
    ])
    payments.find.mockResolvedValue([])
    deposits.find.mockResolvedValue([
      {
        _id: new ObjectId(DEP_ID),
        landlordId: 'landlord-2',
        tenantId: 'tenant-1',
        status: 'paid',
        paidAt: new Date(),
      },
    ])
    payouts.find.mockResolvedValue([])
    users.find.mockResolvedValue([])

    const page = await service.list({})

    expect(page.items[0]!.payeeRole).toBe('landlord')
    expect(page.items[0]!.landlord?.id).toBe('landlord-2')
  })
})

describe('AdminPaymentsService gateway view', () => {
  it('marks internal providers not_applicable and external ones with stored values', async () => {
    const { service, attempts, payments, deposits, payouts, users } = setup()
    const checkedAt = new Date('2026-10-01T00:00:00.000Z')
    attempts.findAndCount.mockResolvedValue([
      [
        makeAttempt({ provider: 'mock-bank', txRef: 'A' }),
        makeAttempt({ provider: 'mocbank', txRef: 'B' }),
        makeAttempt({
          provider: 'zalopay',
          txRef: 'C',
          gatewayStatus: 'succeeded',
          reconcileStatus: 'verified',
          gatewayCheckedAt: checkedAt,
        }),
      ],
      3,
    ])
    payments.find.mockResolvedValue([makePayment()])
    deposits.find.mockResolvedValue([])
    payouts.find.mockResolvedValue([
      makePayout({ settlement: 'external', relayRef: null }),
    ])
    users.find.mockResolvedValue([])

    const { items } = await service.list({})

    expect(items[0]!.gateway).toMatchObject({
      kind: 'internal',
      reconcileStatus: 'not_applicable',
    })
    expect(items[0]!.anomalies).not.toContain('awaiting-reconciliation')
    expect(items[1]!.gateway.kind).toBe('internal')
    expect(items[2]!.gateway).toEqual({
      kind: 'external',
      reconcileStatus: 'verified',
      gatewayStatus: 'succeeded',
      providerTransactionId: 'gw-1',
      checkedAt: checkedAt.toISOString(),
    })
    expect(items[2]!.anomalies).not.toContain('awaiting-reconciliation')
    expect(items[2]!.payout?.settlement).toBe('external')
  })

  it('derives gateway anomalies from stored values', async () => {
    const { service, attempts, payments, deposits, payouts, users } = setup()
    attempts.findAndCount.mockResolvedValue([
      [
        makeAttempt({ txRef: 'N', gatewayStatus: 'not_found' }),
        makeAttempt({
          txRef: 'P',
          status: 'failed',
          gatewayStatus: 'succeeded',
          gatewayAmount: 5_000_000,
        }),
        makeAttempt({
          txRef: 'M',
          gatewayStatus: 'succeeded',
          gatewayAmount: 4_000_000,
          reconcileStatus: 'mismatch',
        }),
      ],
      3,
    ])
    payments.find.mockResolvedValue([makePayment()])
    deposits.find.mockResolvedValue([])
    payouts.find.mockResolvedValue([])
    users.find.mockResolvedValue([])

    const { items } = await service.list({})

    expect(items[0]!.anomalies).toContain('gateway-not-confirmed')
    expect(items[1]!.anomalies).toContain('gateway-paid-not-settled')
    expect(items[2]!.anomalies).toContain('gateway-amount-mismatch')
    expect(items[2]!.anomalies).not.toContain('awaiting-reconciliation')
  })
})

describe('AdminPaymentsService.recheck', () => {
  function recheckSetup(
    attempt: PaymentAttempt,
    afterUpdate?: Partial<PaymentAttempt>
  ): ReturnType<typeof setup> {
    const ctx = setup()
    ctx.attempts.findOne
      .mockResolvedValueOnce(attempt)
      .mockResolvedValue({ ...attempt, ...afterUpdate })
    ctx.payments.find.mockResolvedValue([makePayment()])
    ctx.deposits.find.mockResolvedValue([])
    ctx.payouts.find.mockResolvedValue([])
    ctx.users.find.mockResolvedValue([])
    return ctx
  }
  const gw = (
    over: Partial<{
      state: string
      amount: number | null
    }> = {}
  ): object => ({
    state: 'succeeded',
    providerTransactionId: 'gw-1',
    amount: 5_000_000,
    rawCode: '0',
    message: null,
    ...over,
  })
  const storedSet = (ctx: ReturnType<typeof setup>): Record<string, unknown> =>
    (
      ctx.attempts.updateOne.mock.calls[0] as [
        unknown,
        { $set: Record<string, unknown> },
      ]
    )[1].$set

  it('returns null when the txRef does not exist', async () => {
    const { service, attempts } = setup()
    attempts.findOne.mockResolvedValue(null)

    await expect(service.recheck('missing')).resolves.toBeNull()
  })

  it('verifies a succeeded attempt the gateway confirms, writing only reconcile fields', async () => {
    const attempt = makeAttempt()
    const ctx = recheckSetup(attempt, {
      gatewayStatus: 'succeeded',
      reconcileStatus: 'verified',
      gatewayCheckedAt: new Date(),
    })
    ctx.queryStatus.mockResolvedValue(gw())

    const row = await ctx.service.recheck('TX-1')

    expect(ctx.registry.getForQuery).toHaveBeenCalledWith('momo')
    expect(ctx.queryStatus).toHaveBeenCalledWith({
      txRef: 'TX-1',
      providerTransactionId: 'gw-1',
      amount: 5_000_000,
      createdAt: attempt.createdAt,
    })
    expect(ctx.attempts.updateOne).toHaveBeenCalledWith(
      { _id: attempt._id },
      expect.any(Object)
    )
    const set = storedSet(ctx)
    expect(Object.keys(set).sort()).toEqual([
      'gatewayAmount',
      'gatewayCheckedAt',
      'gatewayStatus',
      'reconcileStatus',
    ])
    expect(set).toMatchObject({
      gatewayStatus: 'succeeded',
      reconcileStatus: 'verified',
    })
    expect(row?.gateway.reconcileStatus).toBe('verified')
    expect(row?.attemptStatus).toBe('succeeded')
    expect(row?.anomalies).not.toContain('awaiting-reconciliation')
  })

  it.each([
    ['gateway failed vs paid attempt', 'succeeded', gw({ state: 'failed' })],
    [
      'gateway not_found vs paid attempt',
      'succeeded',
      gw({ state: 'not_found' }),
    ],
    ['gateway paid vs unpaid attempt', 'failed', gw()],
    ['amount differs', 'succeeded', gw({ amount: 1_000 })],
  ] as const)('flags mismatch: %s', async (_name, status, result) => {
    const ctx = recheckSetup(makeAttempt({ status }))
    ctx.queryStatus.mockResolvedValue(result)

    await ctx.service.recheck('TX-1')

    expect(storedSet(ctx)).toMatchObject({ reconcileStatus: 'mismatch' })
  })

  it('keeps unverified while the gateway is pending and records unavailable on failure', async () => {
    const pending = recheckSetup(makeAttempt())
    pending.queryStatus.mockResolvedValue(gw({ state: 'pending' }))
    await pending.service.recheck('TX-1')
    expect(storedSet(pending)).toMatchObject({
      gatewayStatus: 'pending',
      reconcileStatus: 'unverified',
    })

    const down = recheckSetup(makeAttempt())
    down.queryStatus.mockResolvedValue(
      gw({ state: 'unavailable', amount: null })
    )
    await down.service.recheck('TX-1')
    expect(storedSet(down)).toMatchObject({
      gatewayStatus: 'unavailable',
      reconcileStatus: 'unavailable',
    })

    const boom = recheckSetup(makeAttempt())
    boom.queryStatus.mockRejectedValue(new Error('adapter bug'))
    await expect(boom.service.recheck('TX-1')).resolves.not.toBeNull()
    expect(storedSet(boom)).toMatchObject({ reconcileStatus: 'unavailable' })
  })

  it('never writes attempt, payment or payout status', async () => {
    const ctx = recheckSetup(makeAttempt({ status: 'processing' }))
    ctx.queryStatus.mockResolvedValue(gw())

    await ctx.service.recheck('TX-1')

    expect(storedSet(ctx)).not.toHaveProperty('status')
    expect(ctx.attempts.updateOne).toHaveBeenCalledTimes(1)
    expect(ctx.payments.find).toHaveBeenCalled()
    expect(Object.keys(ctx.payouts)).toEqual(['find'])
  })

  it('does not call a gateway for internal providers', async () => {
    const ctx = recheckSetup(makeAttempt({ provider: 'mock-bank' }))

    const row = await ctx.service.recheck('TX-1')

    expect(ctx.registry.getForQuery).not.toHaveBeenCalled()
    expect(ctx.attempts.updateOne).not.toHaveBeenCalled()
    expect(row?.gateway.reconcileStatus).toBe('not_applicable')
  })
})
