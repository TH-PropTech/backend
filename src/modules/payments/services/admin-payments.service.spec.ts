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
  attempts: Mocks<'find' | 'findOne' | 'findAndCount'>
  payments: Mocks<'find'>
  deposits: Mocks<'find'>
  payouts: Mocks<'find'>
  users: Mocks<'find'>
} {
  const attempts = {
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
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
    users as never
  )
  return { service, attempts, payments, deposits, payouts, users }
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

describe('AdminPaymentsService.recheck', () => {
  it('returns null when the txRef does not exist', async () => {
    const { service, attempts } = setup()
    attempts.findOne.mockResolvedValue(null)

    await expect(service.recheck('missing')).resolves.toBeNull()
  })

  it('re-hydrates a single attempt by txRef', async () => {
    const { service, attempts, payments, deposits, payouts, users } = setup()
    attempts.findOne.mockResolvedValue(makeAttempt())
    payments.find.mockResolvedValue([makePayment()])
    deposits.find.mockResolvedValue([])
    payouts.find.mockResolvedValue([makePayout()])
    users.find.mockResolvedValue([])

    const row = await service.recheck('TX-1')

    expect(row?.txRef).toBe('TX-1')
    expect(row?.payout?.status).toBe('paid-out')
  })
})
