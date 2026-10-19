import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import type { MongoRepository } from 'typeorm'
import type { PaymentProviderName } from '../../mock-bank/providers/payment-provider.port'
import { DepositAgreement } from '../../contracts/schemas/deposit-agreement.schema'
import { User } from '../../users/schemas/user.schema'
import { Payout, type PayoutStatus } from '../../wallets/schemas/payout.schema'
import { Payment } from '../schemas/payment.schema'
import {
  PaymentAttempt,
  type PaymentAttemptStatus,
} from '../schemas/payment-attempt.schema'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
/** An attempt stuck in `processing` this long means the settlement lock never released. */
const STALE_PROCESSING_MINUTES = 15
/** A payout sitting unresolved this long needs a human look. */
const STALE_PAYOUT_HOURS = 24
const SETTLED_PAYMENT_STATUSES = [
  'paid',
  'released',
  'applied-to-lease-security',
]

export interface AdminPaymentPartyView {
  id: string
  name: string
  email: string
}

export interface AdminPaymentPayoutView {
  status: PayoutStatus
  relayRef: string | null
  failureReason: string | null
  paidOutAt: Date | null
}

export interface AdminPaymentRow {
  txRef: string
  provider: PaymentProviderName
  attemptStatus: PaymentAttemptStatus
  amount: number
  paymentType: PaymentAttempt['paymentType']
  contractId: string | null
  createdAt: Date
  payer: AdminPaymentPartyView | null
  landlord: AdminPaymentPartyView | null
  payeeRole: 'landlord' | 'platform' | 'unknown'
  paymentStatus: string | null
  paidAt: Date | null
  payout: AdminPaymentPayoutView | null
  /** Reconciliation hints derived from stored state; no live gateway call. */
  anomalies: string[]
}

export interface AdminPaymentsPage {
  items: AdminPaymentRow[]
  total: number
  page: number
  limit: number
}

export interface AdminPaymentsFilter {
  provider?: PaymentProviderName
  status?: PaymentAttemptStatus
  payoutStatus?: PayoutStatus
  from?: Date
  to?: Date
  q?: string
  page?: number
  limit?: number
}

@Injectable()
export class AdminPaymentsService {
  constructor(
    @InjectRepository(PaymentAttempt)
    private readonly attemptRepository: MongoRepository<PaymentAttempt>,
    @InjectRepository(Payment)
    private readonly paymentRepository: MongoRepository<Payment>,
    @InjectRepository(DepositAgreement)
    private readonly depositRepository: MongoRepository<DepositAgreement>,
    @InjectRepository(Payout)
    private readonly payoutRepository: MongoRepository<Payout>,
    @InjectRepository(User)
    private readonly userRepository: MongoRepository<User>
  ) {}

  async list(filter: AdminPaymentsFilter): Promise<AdminPaymentsPage> {
    const page = Math.max(1, filter.page || 1)
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, filter.limit || DEFAULT_PAGE_SIZE)
    )

    const clauses: Record<string, unknown>[] = []
    if (filter.provider) clauses.push({ provider: filter.provider })
    if (filter.status) clauses.push({ status: filter.status })
    if (filter.from || filter.to) {
      clauses.push({
        createdAt: {
          ...(filter.from ? { $gte: filter.from } : {}),
          ...(filter.to ? { $lte: filter.to } : {}),
        },
      })
    }
    if (filter.q) {
      clauses.push({ $or: [{ txRef: filter.q }, { contractId: filter.q }] })
    }

    if (filter.payoutStatus) {
      const payouts = await this.payoutRepository.find({
        where: { status: filter.payoutStatus } as never,
      })
      const paymentIds = payouts.map(p => p.paymentId)
      if (!paymentIds.length) return { items: [], total: 0, page, limit }
      clauses.push({
        $or: [
          { paymentId: { $in: paymentIds } },
          { paymentIds: { $in: paymentIds } },
        ],
      })
    }

    const where = clauses.length ? { $and: clauses } : {}

    const [attempts, total] = await this.attemptRepository.findAndCount({
      where: where as never,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    })

    return { items: await this.hydrate(attempts), total, page, limit }
  }

  /** Re-reads current state for one txRef; does not call VNPay/MoMo/ZaloPay. */
  async recheck(txRef: string): Promise<AdminPaymentRow | null> {
    const attempt = await this.attemptRepository.findOne({ where: { txRef } })
    if (!attempt) return null
    const [row] = await this.hydrate([attempt])
    return row ?? null
  }

  private async hydrate(
    attempts: PaymentAttempt[]
  ): Promise<AdminPaymentRow[]> {
    if (!attempts.length) return []

    const paymentIds = new Set<string>()
    for (const attempt of attempts) {
      paymentIds.add(attempt.paymentId)
      for (const id of attempt.paymentIds ?? []) paymentIds.add(id)
    }
    const objectIds = [...paymentIds]
      .filter(id => ObjectId.isValid(id))
      .map(id => new ObjectId(id))

    const [payments, deposits] = await Promise.all([
      objectIds.length
        ? this.paymentRepository.find({
            where: { _id: { $in: objectIds } } as never,
          })
        : Promise.resolve([]),
      objectIds.length
        ? this.depositRepository.find({
            where: { _id: { $in: objectIds } } as never,
          })
        : Promise.resolve([]),
    ])

    const payouts = paymentIds.size
      ? await this.payoutRepository.find({
          where: { paymentId: { $in: [...paymentIds] } } as never,
        })
      : []

    const userIds = new Set<string>()
    for (const attempt of attempts) userIds.add(attempt.userId)
    for (const payment of payments) userIds.add(payment.landlordId)
    for (const deposit of deposits) userIds.add(deposit.landlordId)
    const userObjectIds = [...userIds]
      .filter(id => ObjectId.isValid(id))
      .map(id => new ObjectId(id))
    const users = userObjectIds.length
      ? await this.userRepository.find({
          where: { _id: { $in: userObjectIds } } as never,
        })
      : []

    const paymentById = new Map(payments.map(p => [String(p._id), p]))
    const depositById = new Map(deposits.map(d => [String(d._id), d]))
    const payoutByPaymentId = new Map(payouts.map(p => [p.paymentId, p]))
    const userById = new Map(users.map(u => [String(u._id), u]))

    const toParty = (
      id: string | null | undefined
    ): AdminPaymentPartyView | null => {
      if (!id) return null
      const user = userById.get(id)
      return {
        id,
        name: user?.fullName ?? '(không rõ)',
        email: user?.email ?? '',
      }
    }

    return attempts.map(attempt => {
      const settlementPayment =
        !paymentById.has(attempt.paymentId) && attempt.paymentIds?.length
          ? paymentById.get(attempt.paymentIds[0] as string)
          : undefined
      const payment = paymentById.get(attempt.paymentId) ?? settlementPayment
      const deposit = depositById.get(attempt.paymentId)

      const landlordId = payment?.landlordId ?? deposit?.landlordId ?? null
      const payeeRole: AdminPaymentRow['payeeRole'] = payment
        ? payment.payeeRole === 'platform'
          ? 'platform'
          : 'landlord'
        : deposit
          ? 'landlord'
          : 'unknown'

      const payoutId = payment
        ? String(payment._id)
        : deposit
          ? String(deposit._id)
          : null
      const payout = payoutId ? payoutByPaymentId.get(payoutId) : undefined

      const paymentStatus = payment?.status ?? deposit?.status ?? null
      const paidAt = payment?.paidAt ?? deposit?.paidAt ?? null

      const anomalies: string[] = []
      if (
        attempt.status === 'succeeded' &&
        paymentStatus &&
        !SETTLED_PAYMENT_STATUSES.includes(paymentStatus)
      ) {
        anomalies.push('attempt-succeeded-payment-not-paid')
      }
      if (paidAt && payeeRole === 'landlord' && !payout) {
        anomalies.push('paid-without-payout')
      }
      if (payout?.status === 'failed') anomalies.push('payout-failed')
      if (
        payout &&
        (payout.status === 'awaiting-wallet' || payout.status === 'pending')
      ) {
        const ageHours = (Date.now() - payout.createdAt.getTime()) / 3_600_000
        if (ageHours > STALE_PAYOUT_HOURS) anomalies.push('payout-stuck')
      }
      if (attempt.status === 'processing') {
        const ageMinutes = (Date.now() - attempt.updatedAt.getTime()) / 60_000
        if (ageMinutes > STALE_PROCESSING_MINUTES) {
          anomalies.push('attempt-stuck-processing')
        }
      }

      return {
        txRef: attempt.txRef,
        provider: attempt.provider,
        attemptStatus: attempt.status,
        amount: attempt.amount,
        paymentType: attempt.paymentType,
        contractId: attempt.contractId,
        createdAt: attempt.createdAt,
        payer: toParty(attempt.userId),
        landlord: toParty(landlordId),
        payeeRole,
        paymentStatus,
        paidAt,
        payout: payout
          ? {
              status: payout.status,
              relayRef: payout.relayRef ?? null,
              failureReason: payout.failureReason,
              paidOutAt: payout.paidOutAt,
            }
          : null,
        anomalies,
      }
    })
  }
}
