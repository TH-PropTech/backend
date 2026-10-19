import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { Repository } from 'typeorm'
import { DepositAgreementsService } from '../../contracts/services/deposit-agreements.service'
import { evaluatePayDeposit } from '../../contracts/flow/flow-guards'
import { Payment } from '../../payments/schemas/payment.schema'
import {
  PaymentAttempt,
  type PaymentAttemptStatus,
  type PaymentClientChannel,
} from '../../payments/schemas/payment-attempt.schema'
import type { PaymentCallbackDto } from '../dto/init-payment.dto'
import { ObjectId } from 'mongodb'
import type { WalletBrand } from '../../wallets/utils/supported-banks'
import { PaymentProviderRegistry } from '../providers/payment-provider.registry'
import type {
  GatewayVerdict,
  MomoPaymentMethod,
  ZalopayPaymentMethod,
  PaymentProviderName,
} from '../providers/payment-provider.port'
import type { PaymentsConfig } from '../../../config/configuration'
import { LedgerOutboxService } from '../../fabric/services/ledger-outbox.service'
import {
  buildPaymentRequest,
  type PaymentRequestView,
} from '../utils/payment-request.builder'
import type { DepositAgreement } from '../../contracts/schemas/deposit-agreement.schema'
import { Contract } from '../../contracts/schemas/contract.schema'
import { MoveInSettlement } from '../../rental/schemas/move-in-settlement.schema'
import { MoveInSettlementsService } from '../../rental/services/move-in-settlements.service'
import { PayoutsService } from '../../wallets/services/payouts.service'
import { WalletsService } from '../../wallets/services/wallets.service'
import { RentalTransactionEventService } from '../../rental/services/rental-transaction-event.service'
import type { RentalTransactionActorRole } from '../../rental/schemas/rental-transaction-event.schema'
import { RentalApplication } from '../../rental/schemas/rental-application.schema'

const CALLBACK_WINDOW_MS = 5 * 60 * 1000

/** Khoản thuộc về sàn (phí sàn, phí dịch vụ khách thuê), không trả cho chủ nhà. */
const isPlatformPayment = (payment: Payment): boolean =>
  payment.type === 'platform-fee' || payment.payeeRole === 'platform'

/** Khách đã trả thẳng vào tài khoản Ví Mộc của chủ nhà (không qua ví sàn). */
const isDirectReceiptAttempt = (
  attempt: Pick<PaymentAttempt, 'provider' | 'payeeAccountNumber'>
): boolean =>
  attempt.provider === 'mocbank' && Boolean(attempt.payeeAccountNumber)

export type MockPaymentInit = {
  provider: PaymentProviderName
  txRef: string
  amount: number
  description: string
  qrCode: string
  deepLink: string
  expiresAt: Date
  status: 'pending'
}

export type GatewayPaymentResult = {
  txRef: string
  provider: PaymentProviderName
  paymentType: 'deposit' | 'rent' | 'settlement' | 'invoice'
  attemptStatus: PaymentAttemptStatus
  targetPaid: boolean
  contractId: string | null
}

export type PaymentInitOptions = {
  provider?: PaymentProviderName | undefined
  clientChannel?: PaymentClientChannel | undefined
  clientIp?: string | undefined
  momoMethod?: MomoPaymentMethod | undefined
  zalopayMethod?: ZalopayPaymentMethod | undefined
  /** Ví Mộc: thương hiệu ví của chủ nhà nhận tiền (mặc định mocbank). */
  brand?: WalletBrand | undefined
}

type PaymentType = PaymentAttempt['paymentType']

/** Outcome of applying a verified provider result to an attempt. */
export type SettlementOutcome =
  | 'settled'
  | 'replayed'
  | 'failed'
  | 'duplicate-paid'

/** Statuses a verified success may still settle from (late success, D4). */
const SETTLEABLE_STATUSES: PaymentAttemptStatus[] = [
  'pending',
  'expired',
  'failed',
]

export type CallbackHeaders = {
  timestamp: string
  nonce: string
  signature: string
}

export type MockPaymentCallbackResult = {
  status: 'succeeded'
  txRef: string
  replayed: boolean
}

export type ReceiptView = {
  receiptCode: string
  receiptHash: string
  paymentId: string
  contractId: string | null
  type: string
  amountBeforeVat: number
  vatAmount: number
  amount: number
  paidAt: string
  txRef: string
  ledger: {
    status: 'not-required' | 'pending' | 'confirmed' | 'failed'
    networkMode: 'simulation' | 'fabric' | null
  }
}

@Injectable()
export class MockBankService {
  private readonly logger = new Logger(MockBankService.name)

  constructor(
    private readonly depositAgreementsService: DepositAgreementsService,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(PaymentAttempt)
    private readonly attemptRepository: Repository<PaymentAttempt>,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly configService: ConfigService,
    private readonly ledgerOutboxService: LedgerOutboxService,
    @InjectRepository(MoveInSettlement)
    private readonly settlementRepository: Repository<MoveInSettlement>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService,
    @Optional()
    private readonly moveInSettlementsService?: MoveInSettlementsService,
    @Optional()
    private readonly payoutsService?: PayoutsService,
    @Optional()
    private readonly walletsService?: WalletsService,
    @Optional()
    @InjectRepository(RentalApplication)
    private readonly rentalApplicationRepository?: Repository<RentalApplication>
  ) {}

  private async recordTransactionEvent(input: {
    transactionKey: string
    contractId?: string | null
    eventType: string
    actorRole: RentalTransactionActorRole
    actorId?: string | null
    reasonCode?: string | null
    refs?: Record<string, string>
    transitionKey: string
  }): Promise<void> {
    if (!this.transactionEventService) return
    try {
      await this.transactionEventService.record({
        transactionKey: input.transactionKey,
        contractId: input.contractId ?? null,
        eventType: input.eventType,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        reasonCode: input.reasonCode ?? null,
        refs: input.refs ?? {},
        transitionKey: input.transitionKey,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Rental transaction audit failed for mock-bank event [${input.eventType}]: ${message}`
      )
    }
  }

  async initDepositPayment(
    depositAgreementId: string,
    currentUserId: string,
    options: PaymentInitOptions = {}
  ): Promise<PaymentRequestView> {
    const agreement = await this.depositAgreementsService.getAgreement(
      depositAgreementId,
      currentUserId,
      false
    )
    const payGuard = evaluatePayDeposit({
      status: agreement.status,
      hasConsent: Boolean(agreement.tenantConsent),
    })
    if (!payGuard.enabled) {
      throw new ConflictException('DEPOSIT_NOT_READY')
    }
    if (agreement.tenantId !== currentUserId) {
      throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
    }
    const provider = this.providerRegistry.get(options.provider).name
    const contract =
      !agreement.linkedLeaseContractId && agreement.applicationId
        ? await this.contractRepository.findOne({
            where: { rentalApplicationId: agreement.applicationId },
          })
        : null
    const { payment, reused } = await this.createAttempt({
      userId: agreement.tenantId,
      amount: agreement.amount,
      description: `Deposit ${agreement.agreementCode}`,
      paymentId: agreement._id.toString(),
      paymentType: 'deposit',
      contractId:
        agreement.linkedLeaseContractId ?? contract?._id.toHexString() ?? null,
      payeeLandlordId: agreement.landlordId,
      options: { ...options, provider },
    })
    if (!reused) {
      await this.depositAgreementsService.markPaymentPending(
        agreement._id.toString(),
        currentUserId
      )
    }
    return this.toDepositPaymentRequest(agreement, payment)
  }

  async getGatewayPaymentResult(
    txRef: string,
    userId: string
  ): Promise<GatewayPaymentResult> {
    const attempt = await this.attemptRepository.findOne({
      where: { txRef, userId },
    })
    if (!attempt) throw new NotFoundException('PAYMENT_ATTEMPT_NOT_FOUND')

    let targetPaid: boolean
    if (attempt.paymentType === 'deposit') {
      const agreement = await this.depositAgreementsService.getAgreement(
        attempt.paymentId,
        userId,
        false
      )
      targetPaid =
        agreement.status === 'paid' ||
        agreement.status === 'applied-to-lease-security'
    } else if (attempt.paymentType === 'settlement') {
      const settlement = await this.findSettlement(attempt.paymentId)
      if (settlement.tenantId !== userId) {
        throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
      }
      targetPaid = settlement.status === 'paid'
    } else {
      const payment = await this.findPayment(attempt.paymentId)
      if ((payment.payerId ?? payment.tenantId) !== userId) {
        throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
      }
      targetPaid = payment.status === 'paid'
    }

    return {
      txRef: attempt.txRef,
      provider: attempt.provider,
      paymentType: attempt.paymentType,
      attemptStatus: attempt.status,
      targetPaid,
      contractId: attempt.contractId ?? null,
    }
  }

  async getDepositPaymentRequest(
    depositAgreementId: string,
    currentUserId: string,
    isStaff: boolean
  ): Promise<PaymentRequestView | null> {
    const agreement = await this.depositAgreementsService.getAgreement(
      depositAgreementId,
      currentUserId,
      isStaff
    )
    const attempt = await this.attemptRepository.findOne({
      where: { paymentId: depositAgreementId, paymentType: 'deposit' },
      order: { createdAt: 'DESC' },
    })
    if (!attempt) return null
    return this.toDepositPaymentRequest(
      agreement,
      this.toPaymentInit(attempt, `Deposit ${agreement.agreementCode}`)
    )
  }

  async getPaymentRequest(
    paymentId: string,
    currentUserId: string,
    isStaff: boolean
  ): Promise<PaymentRequestView | null> {
    if (!ObjectId.isValid(paymentId))
      throw new NotFoundException('PAYMENT_NOT_FOUND')
    const payment = await this.paymentRepository.findOne({
      where: { _id: new ObjectId(paymentId) },
    })
    if (!payment) throw new NotFoundException('PAYMENT_NOT_FOUND')
    if (!isStaff && (payment.payerId ?? payment.tenantId) !== currentUserId) {
      throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
    }
    const paymentType = payment.type === 'platform-fee' ? 'invoice' : 'rent'
    const attempt = await this.attemptRepository.findOne({
      where: { paymentId, paymentType },
      order: { createdAt: 'DESC' },
    })
    if (!attempt) return null
    const amountBeforeVat = payment.amountBeforeVat ?? payment.amount
    const vatAmount = payment.vatAmount ?? 0
    return buildPaymentRequest({
      payment: this.toPaymentInit(attempt, payment.description),
      invoiceCode:
        payment.invoiceCode ?? `INV-${payment._id.toHexString().slice(-6)}`,
      purpose: payment.type === 'platform-fee' ? 'PLATFORM_FEE' : 'RENT',
      lines: [
        {
          kind: payment.type ?? 'rent',
          description: payment.description,
          amountBeforeVat,
          vatAmount,
          amount: payment.amount,
          paymentId: payment._id.toHexString(),
        },
      ],
      payer: {
        role: payment.payerRole ?? 'tenant',
      },
      payee: {
        role: payment.payeeRole ?? 'landlord',
        displayName:
          (payment.payeeRole ?? 'landlord') === 'platform'
            ? 'Thach Homes'
            : 'Landlord',
      },
      dueAt: payment.dueDate,
      simulation: attempt.provider === 'mock-bank',
    })
  }

  async getPaymentReceipt(
    paymentId: string,
    currentUserId: string,
    isStaff: boolean
  ): Promise<ReceiptView> {
    const payment = await this.findPayment(paymentId)
    if (
      !isStaff &&
      payment.tenantId !== currentUserId &&
      payment.landlordId !== currentUserId
    ) {
      throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
    }
    if (
      payment.status !== 'paid' ||
      !payment.paidAt ||
      !payment.txRef ||
      !payment.receiptCode ||
      !payment.receiptHash
    ) {
      throw new NotFoundException('RECEIPT_NOT_AVAILABLE')
    }
    return this.toReceiptView(payment)
  }

  async getDepositReceipt(
    depositAgreementId: string,
    currentUserId: string,
    isStaff: boolean
  ): Promise<ReceiptView> {
    const agreement = await this.depositAgreementsService.getAgreement(
      depositAgreementId,
      currentUserId,
      isStaff
    )
    if (!agreement.paidAt || !agreement.receiptCode || !agreement.receiptHash) {
      throw new NotFoundException('RECEIPT_NOT_AVAILABLE')
    }
    const attempt = await this.attemptRepository.findOne({
      where: { paymentId: depositAgreementId, paymentType: 'deposit' },
      order: { createdAt: 'DESC' },
    })
    if (!attempt || attempt.status !== 'succeeded') {
      throw new NotFoundException('RECEIPT_NOT_AVAILABLE')
    }
    return {
      receiptCode: agreement.receiptCode,
      receiptHash: agreement.receiptHash,
      paymentId: agreement._id.toHexString(),
      contractId: agreement.linkedLeaseContractId ?? null,
      type: 'deposit',
      amountBeforeVat: agreement.amount,
      vatAmount: 0,
      amount: agreement.amount,
      paidAt: agreement.paidAt.toISOString(),
      txRef: attempt.txRef,
      ledger: {
        status:
          (agreement.ledgerStatus as ReceiptView['ledger']['status']) ??
          'pending',
        networkMode: null,
      },
    }
  }

  async initRentPayment(
    paymentId: string,
    currentUserId: string,
    options: PaymentInitOptions = {}
  ): Promise<MockPaymentInit> {
    if (!ObjectId.isValid(paymentId))
      throw new NotFoundException('PAYMENT_NOT_FOUND')
    const payment = await this.paymentRepository.findOne({
      where: { _id: new ObjectId(paymentId) },
    })
    if (!payment) throw new NotFoundException('PAYMENT_NOT_FOUND')
    if (payment.tenantId !== currentUserId) {
      throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
    }
    if (payment.status === 'paid')
      throw new ConflictException('PAYMENT_ALREADY_PAID')
    const { payment: init } = await this.createAttempt({
      userId: payment.tenantId,
      amount: payment.amount,
      description: payment.description,
      paymentId: payment._id.toString(),
      paymentType: 'rent',
      contractId: payment.contractId ?? null,
      payeeLandlordId: isPlatformPayment(payment) ? null : payment.landlordId,
      options,
    })
    return init
  }

  async initInvoicePayment(
    paymentId: string,
    currentUserId: string,
    options: PaymentInitOptions = {}
  ): Promise<PaymentRequestView> {
    const invoice = await this.findPayment(paymentId)
    if ((invoice.payerId ?? invoice.tenantId) !== currentUserId) {
      throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
    }
    if (invoice.status === 'paid' || invoice.status === 'waived') {
      throw new ConflictException('PAYMENT_ALREADY_PAID')
    }
    if (options.provider && options.provider !== 'mocbank') {
      throw new UnprocessableEntityException('INVOICE_PROVIDER_NOT_SUPPORTED')
    }
    const { payment } = await this.createAttempt({
      userId: currentUserId,
      amount: invoice.amount,
      description: invoice.description,
      paymentId: invoice._id.toHexString(),
      paymentType: 'invoice',
      contractId: invoice.contractId,
      options: { ...options, provider: 'mocbank' },
    })
    return this.toInvoicePaymentRequest(invoice, payment)
  }

  async initSettlementPayment(
    settlementId: string,
    currentUserId: string,
    options: PaymentInitOptions = {}
  ): Promise<PaymentRequestView> {
    const settlement = await this.findSettlement(settlementId)
    if (settlement.tenantId !== currentUserId) {
      throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
    }
    if (settlement.status === 'paid' || settlement.status === 'cancelled') {
      throw new ConflictException('SETTLEMENT_NOT_PAYABLE')
    }
    const unpaidLines = settlement.lines.filter(
      line => !line.paidAt && Boolean(line.paymentId)
    )
    const payments = await Promise.all(
      unpaidLines.map(line => this.findPayment(line.paymentId ?? ''))
    )
    const payable = payments.filter(
      payment => payment.status !== 'paid' && payment.status !== 'waived'
    )
    if (!payable.length) throw new ConflictException('SETTLEMENT_NOT_PAYABLE')
    const { group, payeeLandlordId } = this.groupSettlementPayments(
      this.providerRegistry.get(options.provider).name,
      payable,
      settlement.landlordId
    )
    const amount = group.reduce((sum, payment) => sum + payment.amount, 0)
    const description = `Settlement ${settlement._id.toHexString()}`
    const { payment } = await this.createAttempt({
      userId: settlement.tenantId,
      amount,
      description,
      paymentId: settlement._id.toHexString(),
      paymentType: 'settlement',
      contractId: settlement.contractId,
      paymentIds: group.map(item => item._id.toHexString()),
      payeeLandlordId,
      options,
    })
    return buildPaymentRequest({
      payment,
      invoiceCode: `STL-${settlement._id.toHexString().slice(-8)}`,
      purpose: 'SETTLEMENT',
      lines: group.map(item => {
        const line = unpaidLines.find(
          candidate => candidate.paymentId === item._id.toHexString()
        )
        return {
          kind: line?.kind ?? item.type ?? 'settlement',
          description: item.description,
          amountBeforeVat: item.amountBeforeVat ?? item.amount,
          vatAmount: item.vatAmount ?? 0,
          amount: item.amount,
          paymentId: item._id.toHexString(),
        }
      }),
      payer: { role: 'tenant' },
      payee: {
        role: group.some(item => !isPlatformPayment(item))
          ? 'landlord'
          : 'platform',
        displayName: group.some(item => !isPlatformPayment(item))
          ? 'Landlord'
          : 'Platform',
      },
      dueAt: settlement.dueAt,
      simulation: payment.provider === 'mock-bank',
    })
  }

  async handleDepositCallback(
    body: PaymentCallbackDto,
    headers: CallbackHeaders
  ): Promise<MockPaymentCallbackResult> {
    return this.handleMockCallback(body, headers, 'deposit')
  }

  async handleRentCallback(
    body: PaymentCallbackDto,
    headers: CallbackHeaders
  ): Promise<MockPaymentCallbackResult> {
    return this.handleMockCallback(body, headers, 'rent')
  }

  async handleSettlementCallback(
    body: PaymentCallbackDto,
    headers: CallbackHeaders
  ): Promise<MockPaymentCallbackResult> {
    return this.handleMockCallback(body, headers, 'settlement')
  }

  async handleInvoiceCallback(
    body: PaymentCallbackDto,
    headers: CallbackHeaders
  ): Promise<MockPaymentCallbackResult> {
    return this.handleMockCallback(body, headers, 'invoice')
  }

  /**
   * Single settlement entry for every provider (D4). Callers must have
   * verified the provider signature, reference and amount first.
   *
   * - already succeeded → `replayed`, no side effect
   * - verified failure → pending attempt marked `failed`
   * - success while the target was already paid by another attempt →
   *   `duplicate-paid` event for staff; no second payment transition
   * - otherwise the matching deposit/rent/settlement/invoice path runs once,
   *   guarded by a conditional `processing` lock against concurrent
   *   IPN + browser-return delivery.
   */
  async settleVerifiedAttempt(
    attempt: PaymentAttempt,
    verdict: Pick<GatewayVerdict, 'succeeded' | 'providerTransactionId'>,
    callbackDigest: string
  ): Promise<SettlementOutcome> {
    if (attempt.status === 'succeeded') return 'replayed'
    if (!verdict.succeeded) {
      if (attempt.status === 'pending') {
        attempt.status = 'failed'
        attempt.processedAt = new Date()
        attempt.callbackDigest = callbackDigest
        await this.attemptRepository.save(attempt)
        await this.recordAttemptEvent(attempt, 'payment-attempt.failed')
      }
      return 'failed'
    }
    const previousStatus = attempt.status
    if (!SETTLEABLE_STATUSES.includes(previousStatus)) return 'replayed'
    const locked = await this.attemptRepository.update(
      {
        _id: attempt._id,
        status: { $in: SETTLEABLE_STATUSES },
      } as never,
      { status: 'processing' }
    )
    if (!locked.affected) return 'replayed'
    attempt.status = 'processing'
    attempt.providerTransactionId = verdict.providerTransactionId
    try {
      if (await this.isTargetPaidElsewhere(attempt)) {
        await this.markDuplicatePaid(attempt, callbackDigest)
        return 'duplicate-paid'
      }
      await this.settleByType(attempt, callbackDigest)
      return 'settled'
    } catch (error) {
      await this.attemptRepository.update(
        { _id: attempt._id, status: 'processing' } as never,
        { status: previousStatus }
      )
      attempt.status = previousStatus
      throw error
    }
  }

  private async handleMockCallback(
    body: PaymentCallbackDto,
    headers: CallbackHeaders,
    paymentType: PaymentType
  ): Promise<MockPaymentCallbackResult> {
    this.assertMockProvider()
    const attempt = await this.verifyCallback(body, headers, paymentType)
    const outcome = await this.settleVerifiedAttempt(
      attempt,
      { succeeded: true, providerTransactionId: null },
      this.callbackDigest(body, headers)
    )
    return {
      status: 'succeeded',
      txRef: attempt.txRef,
      replayed: outcome !== 'settled',
    }
  }

  private async settleByType(
    attempt: PaymentAttempt,
    callbackDigest: string
  ): Promise<void> {
    const receiptSecret = this.receiptSecret(attempt.provider)
    switch (attempt.paymentType) {
      case 'deposit':
        return this.settleDepositAttempt(attempt, callbackDigest, receiptSecret)
      case 'settlement':
        return this.settleSettlementAttempt(
          attempt,
          callbackDigest,
          receiptSecret
        )
      case 'invoice':
        return this.settleInvoiceAttempt(attempt, callbackDigest, receiptSecret)
      default:
        return this.settleRentAttempt(attempt, callbackDigest, receiptSecret)
    }
  }

  /** True when the payment target was already settled by another attempt. */
  private async isTargetPaidElsewhere(
    attempt: PaymentAttempt
  ): Promise<boolean> {
    if (attempt.paymentType === 'deposit') {
      const agreement = await this.depositAgreementsService.getAgreement(
        attempt.paymentId,
        attempt.userId,
        true
      )
      return (
        (agreement.status === 'paid' ||
          agreement.status === 'applied-to-lease-security') &&
        agreement.paymentAttemptId !== attempt._id.toString()
      )
    }
    if (attempt.paymentType === 'settlement') {
      const settlement = await this.findSettlement(attempt.paymentId)
      return settlement.status === 'paid'
    }
    const payment = await this.findPayment(attempt.paymentId)
    return (
      (payment.status === 'paid' || payment.status === 'waived') &&
      payment.txRef !== attempt.txRef
    )
  }

  private async markDuplicatePaid(
    attempt: PaymentAttempt,
    callbackDigest: string
  ): Promise<void> {
    await this.markAttemptSucceeded(attempt, callbackDigest)
    this.logger.warn(
      `Duplicate payment provider=${attempt.provider} txRef=${attempt.txRef} target=${attempt.paymentType}:${attempt.paymentId}`
    )
    await this.recordTransactionEvent({
      transactionKey: attempt.contractId ?? attempt.paymentId,
      contractId: attempt.contractId ?? null,
      eventType: 'payment-attempt.duplicate-paid',
      actorRole: 'provider',
      reasonCode: 'DUPLICATE_PROVIDER_PAYMENT',
      refs: {
        paymentId: attempt.paymentId,
        txRef: attempt.txRef,
        provider: attempt.provider,
        amount: String(attempt.amount),
      },
      transitionKey: `payment-attempt:${attempt._id.toHexString()}:duplicate-paid`,
    })
  }

  private async settleRentAttempt(
    attempt: PaymentAttempt,
    callbackDigest: string,
    receiptSecret: string
  ): Promise<void> {
    await this.markAttemptSucceeded(attempt, callbackDigest)
    const payment = await this.findPayment(attempt.paymentId)
    await this.markPaymentPaid(payment, attempt, new Date(), receiptSecret, {
      receiptType: 'rent',
      hashType: 'rent',
    })
    await this.recordTransactionEvent({
      transactionKey: payment.contractId ?? payment._id.toHexString(),
      contractId: payment.contractId,
      eventType: 'payment.succeeded',
      actorRole: 'provider',
      refs: { paymentId: payment._id.toHexString() },
      transitionKey: `payment:${attempt._id.toHexString()}:succeeded`,
    })
  }

  private async settleSettlementAttempt(
    attempt: PaymentAttempt,
    callbackDigest: string,
    receiptSecret: string
  ): Promise<void> {
    const settlement = await this.findSettlement(attempt.paymentId)
    const paidAt = new Date()
    const paymentIds = attempt.paymentIds ?? []
    for (const paymentId of paymentIds) {
      const payment = await this.findPayment(paymentId)
      if (payment.status === 'paid' || payment.status === 'waived') continue
      await this.markPaymentPaid(payment, attempt, paidAt, receiptSecret, {
        receiptType: 'rent',
        hashType: payment.type ?? 'rent',
      })
    }
    const wasPaid = settlement.status === 'paid'
    settlement.lines = settlement.lines.map(line =>
      line.paymentId && paymentIds.includes(line.paymentId) && !line.paidAt
        ? { ...line, paidAt }
        : line
    )
    settlement.status = settlement.lines.every(line => Boolean(line.paidAt))
      ? 'paid'
      : 'partially-paid'
    await this.settlementRepository.save(settlement)
    if (!wasPaid && settlement.status === 'paid') {
      // PROP-399 D3: sinh bằng chứng MOVE_IN_SETTLED đúng một lần, sau khi trạng thái nghiệp vụ đã lưu.
      try {
        await this.moveInSettlementsService?.recordSettlementPaidEvidence(
          settlement
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn(
          `Settlement ledger evidence failed for [${settlement._id.toHexString()}]: ${message}`
        )
      }
    }
    await this.markAttemptSucceeded(attempt, callbackDigest, paidAt)
    await this.recordTransactionEvent({
      transactionKey: settlement.contractId ?? settlement._id.toHexString(),
      contractId: settlement.contractId ?? null,
      eventType: 'payment.succeeded',
      actorRole: 'provider',
      refs: { settlementId: settlement._id.toHexString() },
      transitionKey: `payment:${attempt._id.toHexString()}:succeeded`,
    })
  }

  private async settleInvoiceAttempt(
    attempt: PaymentAttempt,
    callbackDigest: string,
    receiptSecret: string
  ): Promise<void> {
    const payment = await this.findPayment(attempt.paymentId)
    if (payment.status !== 'paid' && payment.status !== 'waived') {
      const type = payment.type ?? 'platform-fee'
      await this.markPaymentPaid(payment, attempt, new Date(), receiptSecret, {
        receiptType: type,
        hashType: type,
      })
    }
    await this.markAttemptSucceeded(attempt, callbackDigest)
    await this.recordTransactionEvent({
      transactionKey: payment.contractId ?? payment._id.toHexString(),
      contractId: payment.contractId,
      eventType: 'payment.succeeded',
      actorRole: 'provider',
      refs: { paymentId: payment._id.toHexString() },
      transitionKey: `payment:${attempt._id.toHexString()}:succeeded`,
    })
  }

  private async markAttemptSucceeded(
    attempt: PaymentAttempt,
    callbackDigest: string,
    processedAt = new Date()
  ): Promise<void> {
    attempt.status = 'succeeded'
    attempt.processedAt = processedAt
    attempt.callbackDigest = callbackDigest
    await this.attemptRepository.save(attempt)
  }

  /** Shared paid transition for rent/invoice/settlement payments. */
  private async markPaymentPaid(
    payment: Payment,
    attempt: Pick<PaymentAttempt, 'txRef' | 'provider' | 'payeeAccountNumber'>,
    paidAt: Date,
    receiptSecret: string,
    types: { receiptType: string; hashType: string }
  ): Promise<void> {
    payment.status = 'paid'
    payment.paidAt = paidAt
    payment.txRef = attempt.txRef
    Object.assign(
      payment,
      this.createReceipt(
        payment._id.toHexString(),
        payment.contractId,
        payment.type ?? types.receiptType,
        payment.amount,
        payment.vatAmount ?? 0,
        paidAt,
        attempt.txRef
      )
    )
    payment.paymentHash = this.receiptHash(
      {
        type: types.hashType,
        paymentId: payment._id.toHexString(),
        contractId: payment.contractId,
        txRef: attempt.txRef,
        amount: payment.amount,
      },
      receiptSecret
    )
    payment.ledgerStatus = 'pending'
    await this.paymentRepository.save(payment)
    await this.enqueuePaymentLedgerEvent(payment)
    await this.createPayoutFor(payment, attempt)
  }

  /** Payout failures must never fail the tenant's already-recorded payment. */
  private async createPayoutFor(
    payment: Payment,
    attempt: Pick<PaymentAttempt, 'provider' | 'payeeAccountNumber'>
  ): Promise<void> {
    if (!this.payoutsService) return
    if (isPlatformPayment(payment)) return
    try {
      await this.payoutsService.createForPayment({
        paymentId: payment._id.toHexString(),
        contractId: payment.contractId ?? null,
        landlordId: payment.landlordId,
        amount: payment.amount,
        provider: attempt.provider,
        directReceipt: isDirectReceiptAttempt(attempt)
          ? { paidAt: payment.paidAt ?? new Date() }
          : undefined,
      })
    } catch (error) {
      this.logger.warn(
        `Payout creation failed for payment ${payment._id.toHexString()}: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  async simulateSuccess(txRef: string): Promise<MockPaymentCallbackResult> {
    this.assertMockProvider()
    if (this.configService.get<string>('app.env') === 'production') {
      throw new ServiceUnavailableException('MOCK_BANK_SIMULATION_DISABLED')
    }
    const attempt = await this.attemptRepository.findOne({ where: { txRef } })
    if (!attempt) throw new NotFoundException('PAYMENT_ATTEMPT_NOT_FOUND')
    const timestamp = Date.now().toString()
    const nonce = randomBytes(16).toString('hex')
    const body: PaymentCallbackDto = {
      txRef,
      amount: attempt.amount,
      status: 'success',
    }
    const headers = {
      timestamp,
      nonce,
      signature: this.signCallback(body, timestamp, nonce),
    }
    if (attempt.paymentType === 'deposit')
      return this.handleDepositCallback(body, headers)
    if (attempt.paymentType === 'settlement')
      return this.handleSettlementCallback(body, headers)
    if (attempt.paymentType === 'invoice')
      return this.handleInvoiceCallback(body, headers)
    return this.handleRentCallback(body, headers)
  }

  /**
   * Sweep vận hành (D10): chủ động hết hạn các attempt `pending` đã quá
   * `expiresAt`, thay vì chỉ hết hạn lười khi người dùng khởi tạo lại.
   * Áp dụng cho mọi paymentType (deposit/rent/settlement/invoice).
   */
  async expireStaleAttempts(now = new Date()): Promise<number> {
    const pending = await this.attemptRepository.find({
      where: { status: 'pending' },
    })
    let count = 0
    for (const attempt of pending) {
      if (attempt.expiresAt.getTime() > now.getTime()) continue
      await this.expireAttempt(attempt)
      count += 1
    }
    return count
  }

  signCallback(
    body: PaymentCallbackDto,
    timestamp: string,
    nonce: string
  ): string {
    return createHmac('sha256', this.secret())
      .update(this.canonical(body, timestamp, nonce))
      .digest('hex')
  }

  /**
   * Creates (or reuses) the live attempt for one payment target (D6):
   * same provider (+ same MoMo method) + unexpired → reuse without a gateway
   * call; otherwise the live attempt is expired and a new one is created on
   * the chosen provider.
   * Nothing is persisted when the gateway rejects the create request.
   */
  private async createAttempt(input: {
    userId: string
    amount: number
    description: string
    paymentId: string
    paymentType: PaymentType
    contractId?: string | null
    paymentIds?: string[] | null
    /** Chủ nhà nhận khoản này; không có khi khoản thuộc về sàn. */
    payeeLandlordId?: string | null
    options: PaymentInitOptions
  }): Promise<{ payment: MockPaymentInit; reused: boolean }> {
    const adapter = this.providerRegistry.get(input.options.provider)
    const payeeAccountNumber = await this.resolvePayeeAccount(
      adapter.name,
      input.payeeLandlordId,
      input.options.brand ?? 'mocbank'
    )
    const momoMethod =
      adapter.name === 'momo' ? (input.options.momoMethod ?? 'wallet') : null
    const zalopayMethod =
      adapter.name === 'zalopay' ? (input.options.zalopayMethod ?? 'all') : null
    const live = await this.attemptRepository.findOne({
      where: {
        paymentId: input.paymentId,
        paymentType: input.paymentType,
        userId: input.userId,
        status: 'pending',
      },
    })
    if (live) {
      if (
        live.provider === adapter.name &&
        (live.momoMethod ?? null) === momoMethod &&
        (live.zalopayMethod ?? null) === zalopayMethod &&
        (live.payeeAccountNumber ?? null) === payeeAccountNumber &&
        live.expiresAt.getTime() > Date.now()
      ) {
        return {
          payment: this.toPaymentInit(live, input.description),
          reused: true,
        }
      }
      await this.expireAttempt(live)
    }
    const contractId = input.contractId ?? null
    const configuredTtl = this.configService.get<number>(
      'rentalFlow.payments.attemptTtlMinutes'
    )
    const ttlMinutes =
      typeof configuredTtl === 'number' && configuredTtl > 0
        ? configuredTtl
        : 15
    const intent = await adapter.createPaymentIntent({
      amount: input.amount,
      description: input.description,
      customerRef: input.userId,
      txRef: adapter.newTxRef(),
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
      clientIp: input.options.clientIp,
      momoMethod: momoMethod ?? undefined,
      zalopayMethod: zalopayMethod ?? undefined,
      clientChannel: input.options.clientChannel,
      payeeAccountNumber: payeeAccountNumber ?? undefined,
    })
    const attempt = this.attemptRepository.create({
      provider: intent.provider,
      txRef: intent.txRef,
      paymentId: input.paymentId,
      paymentIds: input.paymentIds ?? null,
      contractId,
      paymentType: input.paymentType,
      userId: input.userId,
      amount: input.amount,
      status: 'pending',
      expiresAt: intent.expiresAt,
      processedAt: null,
      callbackDigest: null,
      providerPaymentUrl: intent.redirectUrl,
      providerTransactionId: null,
      clientChannel: input.options.clientChannel ?? 'web',
      momoMethod,
      zalopayMethod,
      payeeAccountNumber,
    })
    await this.attemptRepository.save(attempt)
    await this.recordTransactionEvent({
      transactionKey: contractId ?? input.paymentId,
      contractId,
      eventType: 'payment-attempt.created',
      actorRole: 'tenant',
      actorId: input.userId,
      refs: { paymentId: input.paymentId },
      transitionKey: `payment-attempt:${attempt._id.toHexString()}:created`,
    })
    return {
      payment: this.toPaymentInit(
        attempt,
        input.description,
        intent.redirectUrl
      ),
      reused: false,
    }
  }

  /**
   * Chỉ Ví Mộc trả thẳng vào tài khoản chủ nhà. Các cổng khác (MoMo,
   * ZaloPay, mock-bank) thu vào sàn và payout chuyển hộ sau (giả lập).
   */
  private async resolvePayeeAccount(
    provider: PaymentProviderName,
    landlordId: string | null | undefined,
    brand: WalletBrand = 'mocbank'
  ): Promise<string | null> {
    if (!landlordId || provider !== 'mocbank') return null
    const account =
      (await this.walletsService?.getMocbankAccountNumber(landlordId, brand)) ??
      null
    if (!account) throw new ConflictException('LANDLORD_WALLET_NOT_LINKED')
    return account
  }

  /**
   * Quyết toán nhận nhà có thể gồm dòng của chủ nhà và dòng của sàn. Với Ví Mộc
   * trả lần lượt: dòng chủ nhà (kèm tài khoản nhận) rồi dòng của sàn; cổng khác
   * trả một lần như trước.
   */
  private groupSettlementPayments(
    provider: PaymentProviderName,
    payable: Payment[],
    landlordId: string
  ): { group: Payment[]; payeeLandlordId: string | null } {
    if (provider !== 'mocbank') {
      return { group: payable, payeeLandlordId: null }
    }
    const landlordLines = payable.filter(item => !isPlatformPayment(item))
    if (landlordLines.length === 0) {
      return { group: payable, payeeLandlordId: null }
    }
    return { group: landlordLines, payeeLandlordId: landlordId }
  }

  private async expireAttempt(attempt: PaymentAttempt): Promise<void> {
    attempt.status = 'expired'
    await this.attemptRepository.save(attempt)
    await this.recordAttemptEvent(attempt, 'payment-attempt.expired')
  }

  private async recordAttemptEvent(
    attempt: PaymentAttempt,
    eventType: 'payment-attempt.expired' | 'payment-attempt.failed'
  ): Promise<void> {
    await this.recordTransactionEvent({
      transactionKey: attempt.contractId ?? attempt.paymentId,
      contractId: attempt.contractId ?? null,
      eventType,
      actorRole: 'system',
      refs: { paymentId: attempt.paymentId },
      transitionKey: `payment-attempt:${attempt._id.toHexString()}:${eventType.split('.')[1]}`,
    })
  }

  private toPaymentInit(
    attempt: PaymentAttempt,
    description: string,
    deepLink = attempt.providerPaymentUrl ??
      `mockbank://pay?txRef=${encodeURIComponent(attempt.txRef)}&amount=${attempt.amount}`
  ): MockPaymentInit {
    return {
      provider: attempt.provider,
      txRef: attempt.txRef,
      amount: attempt.amount,
      description,
      qrCode: `data:text/plain,${encodeURIComponent(deepLink)}`,
      deepLink,
      expiresAt: attempt.expiresAt,
      status: 'pending',
    }
  }

  private toDepositPaymentRequest(
    agreement: Pick<
      DepositAgreement,
      '_id' | 'agreementCode' | 'amount' | 'tenantId' | 'landlordId'
    >,
    payment: MockPaymentInit
  ): PaymentRequestView {
    return buildPaymentRequest({
      payment,
      invoiceCode: agreement.agreementCode,
      purpose: 'DEPOSIT',
      lines: [
        {
          kind: 'deposit',
          description: `Deposit ${agreement.agreementCode}`,
          amountBeforeVat: agreement.amount,
          vatAmount: 0,
          amount: agreement.amount,
          paymentId: agreement._id.toHexString(),
        },
      ],
      payer: { role: 'tenant' },
      payee: { role: 'landlord', displayName: 'Landlord' },
      simulation: payment.provider === 'mock-bank',
    })
  }

  private toInvoicePaymentRequest(
    invoice: Payment,
    payment: MockPaymentInit
  ): PaymentRequestView {
    return buildPaymentRequest({
      payment,
      invoiceCode:
        invoice.invoiceCode ?? `INV-${invoice._id.toHexString().slice(-6)}`,
      purpose:
        invoice.type === 'platform-fee' ? 'PLATFORM_FEE' : 'DEPOSIT_TOPUP',
      lines: [
        {
          kind: invoice.feeKind ?? invoice.type ?? 'invoice',
          description: invoice.description,
          amountBeforeVat: invoice.amountBeforeVat ?? invoice.amount,
          vatAmount: invoice.vatAmount ?? 0,
          amount: invoice.amount,
          paymentId: invoice._id.toHexString(),
        },
      ],
      payer: { role: invoice.payerRole ?? 'tenant' },
      payee: {
        role: invoice.payeeRole ?? 'platform',
        displayName:
          (invoice.payeeRole ?? 'platform') === 'platform'
            ? 'Thach Homes'
            : 'Landlord',
      },
      dueAt: invoice.dueDate,
      simulation: payment.provider === 'mock-bank',
    })
  }

  private async verifyCallback(
    body: PaymentCallbackDto,
    headers: CallbackHeaders,
    expectedType: 'deposit' | 'rent' | 'settlement' | 'invoice'
  ): Promise<PaymentAttempt> {
    if (
      body.status !== 'success' ||
      !Number.isSafeInteger(body.amount) ||
      body.amount <= 0
    ) {
      throw new BadRequestException('INVALID_BANK_CALLBACK')
    }
    const timestamp = Number(headers.timestamp)
    if (
      !Number.isSafeInteger(timestamp) ||
      Math.abs(Date.now() - timestamp) > CALLBACK_WINDOW_MS
    ) {
      throw new BadRequestException('BANK_CALLBACK_EXPIRED')
    }
    const expectedSignature = this.signCallback(
      body,
      headers.timestamp,
      headers.nonce
    )
    const received = Buffer.from(headers.signature ?? '', 'utf8')
    const expected = Buffer.from(expectedSignature, 'utf8')
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new BadRequestException('INVALID_BANK_SIGNATURE')
    }
    const attempt = await this.attemptRepository.findOne({
      where: { txRef: body.txRef },
    })
    if (!attempt || attempt.paymentType !== expectedType) {
      throw new NotFoundException('PAYMENT_ATTEMPT_NOT_FOUND')
    }
    if (attempt.amount !== body.amount)
      throw new ConflictException('BANK_AMOUNT_MISMATCH')
    if (attempt.status === 'succeeded') return attempt
    if (
      attempt.status !== 'pending' ||
      attempt.expiresAt.getTime() < Date.now()
    ) {
      throw new ConflictException('PAYMENT_ATTEMPT_NOT_PENDING')
    }
    return attempt
  }

  private callbackDigest(
    body: PaymentCallbackDto,
    headers: CallbackHeaders
  ): string {
    return createHmac('sha256', this.secret())
      .update(
        `${this.canonical(body, headers.timestamp, headers.nonce)}.${headers.signature}`
      )
      .digest('hex')
  }

  private async findSettlement(id: string): Promise<MoveInSettlement> {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('MOVE_IN_SETTLEMENT_NOT_FOUND')
    const settlement = await this.settlementRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!settlement) throw new NotFoundException('MOVE_IN_SETTLEMENT_NOT_FOUND')
    return settlement
  }

  private async findPayment(id: string): Promise<Payment> {
    if (!ObjectId.isValid(id)) throw new NotFoundException('PAYMENT_NOT_FOUND')
    const payment = await this.paymentRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!payment) throw new NotFoundException('PAYMENT_NOT_FOUND')
    return payment
  }

  private receiptHash(
    payload: Record<string, string | number | null>,
    secret: string
  ): string {
    return createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex')
  }

  private createReceipt(
    paymentId: string,
    contractId: string | null,
    type: string,
    amount: number,
    vat: number,
    paidAt: Date,
    txRef: string
  ): { receiptCode: string; receiptHash: string } {
    const receiptCode = `RCP-${this.base32(
      createHash('sha256').update(`${paymentId}${txRef}`).digest()
    ).slice(0, 11)}`
    const receiptHash = createHash('sha256')
      .update(
        JSON.stringify({
          receiptCode,
          paymentId,
          contractId,
          type,
          amount,
          vat,
          paidAt: paidAt.toISOString(),
          txRef,
        })
      )
      .digest('hex')
    return { receiptCode, receiptHash }
  }

  private base32(input: Buffer): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let bits = 0
    let value = 0
    let result = ''
    for (const byte of input) {
      value = (value << 8) | byte
      bits += 8
      while (bits >= 5) {
        result += alphabet[(value >>> (bits - 5)) & 31]
        bits -= 5
      }
    }
    if (bits > 0) result += alphabet[(value << (5 - bits)) & 31]
    return result
  }

  private toReceiptView(payment: Payment): ReceiptView {
    return {
      receiptCode: payment.receiptCode ?? '',
      receiptHash: payment.receiptHash ?? '',
      paymentId: payment._id.toHexString(),
      contractId: payment.contractId,
      type: payment.type ?? 'rent',
      amountBeforeVat: payment.amountBeforeVat ?? payment.amount,
      vatAmount: payment.vatAmount ?? 0,
      amount: payment.amount,
      paidAt: payment.paidAt?.toISOString() ?? '',
      txRef: payment.txRef ?? '',
      ledger: {
        status: payment.ledgerStatus ?? 'not-required',
        networkMode: payment.ledgerNetworkMode ?? null,
      },
    }
  }

  private async enqueuePaymentLedgerEvent(payment: Payment): Promise<void> {
    if (!payment.paymentHash) return
    await this.ledgerOutboxService.enqueue({
      aggregateType: 'payment',
      aggregateId: payment._id.toHexString(),
      eventType: 'payment.paid',
      action: 'recordPayment',
      args: [
        payment._id.toHexString(),
        payment.contractId,
        payment.amount.toString(),
        payment.paymentHash,
      ],
      metadata: {
        paymentId: payment._id.toHexString(),
        contractId: payment.contractId,
      },
      dependencyKey: `contract:${payment.contractId}:contract.activated`,
    })
  }

  private canonical(
    body: PaymentCallbackDto,
    timestamp: string,
    nonce: string
  ): string {
    return `${timestamp}.${nonce}.${body.txRef}.${body.amount}.${body.status}`
  }

  private secret(): string {
    const secret = this.configService.get<string>('rentalFlow.mockBankSecret')
    if (!secret)
      throw new ServiceUnavailableException('MOCK_BANK_NOT_CONFIGURED')
    return secret
  }

  /** Mock Bank simulation endpoints only work while mock-bank is enabled. */
  private assertMockProvider(): void {
    if (!this.providerRegistry.isEnabled('mock-bank')) {
      throw new ServiceUnavailableException(
        'BANK_PROVIDER_ADAPTER_NOT_CONFIGURED'
      )
    }
  }

  /**
   * HMAC key for internal receipt/deposit hashes, per settling provider
   * (keeps the historical Mock Bank behaviour).
   */
  private receiptSecret(provider: PaymentProviderName): string {
    const payments = this.configService.get<PaymentsConfig>(
      'rentalFlow.payments'
    )
    const secret =
      provider === 'momo'
        ? payments?.momo.secretKey
        : provider === 'zalopay'
          ? payments?.zalopay.key2
          : provider === 'mocbank'
            ? payments?.mocbank.merchantSecret
            : undefined
    return secret || this.secret()
  }

  private async settleDepositAttempt(
    attempt: PaymentAttempt,
    callbackDigest: string,
    receiptSecret: string
  ): Promise<void> {
    attempt.status = 'succeeded'
    attempt.processedAt = new Date()
    attempt.callbackDigest = callbackDigest
    await this.attemptRepository.save(attempt)
    const depositHash = createHmac('sha256', receiptSecret)
      .update(
        JSON.stringify({
          type: 'deposit',
          agreementId: attempt.paymentId,
          paymentAttemptId: attempt._id.toString(),
          txRef: attempt.txRef,
          amount: attempt.amount,
        })
      )
      .digest('hex')
    const paidAt = new Date()
    const receipt = this.createReceipt(
      attempt.paymentId,
      attempt.contractId,
      'deposit',
      attempt.amount,
      0,
      paidAt,
      attempt.txRef
    )
    const agreement = await this.depositAgreementsService.recordDepositPaid(
      attempt.paymentId,
      attempt._id.toString(),
      depositHash,
      { ...receipt, paidAt }
    )
    await this.recordTransactionEvent({
      transactionKey: agreement.applicationId ?? agreement._id.toHexString(),
      contractId: agreement.linkedLeaseContractId ?? null,
      eventType: 'payment.succeeded',
      actorRole: 'provider',
      refs: { paymentId: agreement._id.toHexString() },
      transitionKey: `payment:${attempt._id.toHexString()}:succeeded`,
    })
    await this.ledgerOutboxService.enqueue({
      aggregateType: 'deposit',
      aggregateId: agreement._id.toHexString(),
      eventType: 'deposit.paid',
      action: 'recordDeposit',
      args: [
        agreement._id.toHexString(),
        agreement._id.toHexString(),
        agreement.applicationId,
        agreement.amount.toString(),
        depositHash,
      ],
      metadata: { details: { paymentAttemptId: attempt._id.toString() } },
    })
    await this.createDepositPayout(agreement, attempt, paidAt)
  }

  /** Tiền cọc chuyển tiếp về ví chủ nhà như các khoản thanh toán khác; lỗi payout không làm hỏng cọc đã ghi nhận. */
  private async createDepositPayout(
    agreement: DepositAgreement,
    attempt: Pick<PaymentAttempt, 'provider' | 'payeeAccountNumber'>,
    paidAt: Date
  ): Promise<void> {
    if (!this.payoutsService) return
    try {
      await this.payoutsService.createForPayment({
        paymentId: agreement._id.toHexString(),
        contractId: agreement.linkedLeaseContractId ?? null,
        landlordId: agreement.landlordId,
        amount: agreement.amount,
        provider: attempt.provider,
        directReceipt: isDirectReceiptAttempt(attempt) ? { paidAt } : undefined,
      })
    } catch (error) {
      this.logger.warn(
        `Payout creation failed for deposit ${agreement._id.toHexString()}: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }
}
