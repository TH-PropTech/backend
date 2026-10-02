import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { MongoRepository, Repository } from 'typeorm'
import { DepositAgreementsService } from '../contracts/deposit-agreements.service'
import { evaluatePayDeposit } from '../contracts/flow/flow-guards'
import { Payment } from '../payments/schemas/payment.schema'
import { PaymentAttempt } from '../payments/schemas/payment-attempt.schema'
import { MockWallet } from './schemas/mock-wallet.schema'
import type { PaymentCallbackDto } from './dto/init-payment.dto'
import { ObjectId } from 'mongodb'
import { PaymentProviderRegistry } from './providers/payment-provider.registry'
import type { PaymentProviderName } from './providers/payment-provider.port'
import { LedgerOutboxService } from '../fabric/ledger-outbox.service'
import { VnpayCallbackVerifier } from './providers/vnpay-callback.verifier'
import {
  buildPaymentRequest,
  type PaymentRequestView,
} from './payment-request.builder'
import type { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { MoveInSettlement } from '../move-in-settlements/schemas/move-in-settlement.schema'
import { RentalTransactionEventService } from '../rental-transactions/rental-transaction-event.service'
import type { RentalTransactionActorRole } from '../rental-transactions/schemas/rental-transaction-event.schema'

const CALLBACK_WINDOW_MS = 5 * 60 * 1000

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

type VnpayQuery = Record<string, string | string[] | undefined>

export type VnpayPaymentReturn = {
  status: 'succeeded' | 'failed'
  redirectUrl: string
}

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
    @InjectRepository(MockWallet)
    private readonly walletRepository: MongoRepository<MockWallet>,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly configService: ConfigService,
    private readonly ledgerOutboxService: LedgerOutboxService,
    private readonly vnpayCallbackVerifier: VnpayCallbackVerifier,
    @InjectRepository(MoveInSettlement)
    private readonly settlementRepository: Repository<MoveInSettlement>,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService
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
    currentUserId: string
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
    if (agreement.status === 'payment-pending') {
      const existingAttempt = await this.attemptRepository.findOne({
        where: {
          paymentId: agreement._id.toHexString(),
          paymentType: 'deposit',
          userId: currentUserId,
          status: 'pending',
        },
      })
      if (existingAttempt) {
        if (existingAttempt.expiresAt.getTime() > Date.now()) {
          return this.toDepositPaymentRequest(
            agreement,
            this.toPaymentInit(
              existingAttempt,
              `Deposit ${agreement.agreementCode}`
            )
          )
        }
        existingAttempt.status = 'expired'
        await this.attemptRepository.save(existingAttempt)
        await this.recordTransactionEvent({
          transactionKey:
            agreement.linkedLeaseContractId ?? agreement._id.toHexString(),
          contractId: agreement.linkedLeaseContractId ?? null,
          eventType: 'payment-attempt.expired',
          actorRole: 'system',
          refs: { paymentId: agreement._id.toHexString() },
          transitionKey: `payment-attempt:${existingAttempt._id.toHexString()}:expired`,
        })
      }
    }
    const result = await this.createAttempt(
      agreement.tenantId,
      agreement.amount,
      `Deposit ${agreement.agreementCode}`,
      agreement._id.toString(),
      'deposit',
      agreement.linkedLeaseContractId ?? null
    )
    await this.depositAgreementsService.markPaymentPending(
      agreement._id.toString(),
      currentUserId
    )
    return this.toDepositPaymentRequest(agreement, result)
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
    currentUserId: string
  ): Promise<MockPaymentInit> {
    this.assertMockProvider()
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
    return this.createAttempt(
      payment.tenantId,
      payment.amount,
      payment.description,
      payment._id.toString(),
      'rent'
    )
  }

  async initInvoicePayment(
    paymentId: string,
    currentUserId: string
  ): Promise<PaymentRequestView> {
    this.assertMockProvider()
    const invoice = await this.findPayment(paymentId)
    if ((invoice.payerId ?? invoice.tenantId) !== currentUserId) {
      throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
    }
    if (invoice.status === 'paid' || invoice.status === 'waived') {
      throw new ConflictException('PAYMENT_ALREADY_PAID')
    }
    const payment = await this.createAttempt(
      currentUserId,
      invoice.amount,
      invoice.description,
      invoice._id.toHexString(),
      'invoice',
      invoice.contractId
    )
    return this.toInvoicePaymentRequest(invoice, payment)
  }

  async initSettlementPayment(
    settlementId: string,
    currentUserId: string
  ): Promise<PaymentRequestView> {
    this.assertMockProvider()
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
    const amount = payable.reduce((sum, payment) => sum + payment.amount, 0)
    const description = `Settlement ${settlement._id.toHexString()}`
    const payment = await this.createAttempt(
      settlement.tenantId,
      amount,
      description,
      settlement._id.toHexString(),
      'settlement',
      settlement.contractId,
      payable.map(item => item._id.toHexString())
    )
    return buildPaymentRequest({
      payment,
      invoiceCode: `STL-${settlement._id.toHexString().slice(-8)}`,
      purpose: 'SETTLEMENT',
      lines: payable.map(item => {
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
      payee: { role: 'landlord', displayName: 'Landlord' },
      dueAt: settlement.dueAt,
      simulation: payment.provider === 'mock-bank',
    })
  }

  async handleDepositCallback(
    body: PaymentCallbackDto,
    headers: CallbackHeaders
  ): Promise<MockPaymentCallbackResult> {
    this.assertMockProvider()
    const attempt = await this.verifyCallback(body, headers, 'deposit')
    if (attempt.status === 'succeeded') {
      return { status: 'succeeded', txRef: attempt.txRef, replayed: true }
    }
    await this.settleDepositAttempt(
      attempt,
      this.callbackDigest(body, headers),
      this.secret()
    )
    return { status: 'succeeded', txRef: attempt.txRef, replayed: false }
  }

  async handleVnpayDepositReturn(
    query: VnpayQuery
  ): Promise<VnpayPaymentReturn> {
    this.providerRegistry.assertVnpayProvider()
    const txRef = query.vnp_TxnRef
    if (typeof txRef !== 'string')
      throw new BadRequestException('INVALID_VNPAY_CALLBACK')
    const attempt = await this.attemptRepository.findOne({ where: { txRef } })
    if (
      !attempt ||
      attempt.provider !== 'vnpay' ||
      attempt.paymentType !== 'deposit'
    ) {
      throw new NotFoundException('PAYMENT_ATTEMPT_NOT_FOUND')
    }
    const verified = this.vnpayCallbackVerifier.verify(query, {
      secret: this.vnpaySecret(),
      txRef: attempt.txRef,
      amount: attempt.amount,
    })
    if (!verified.succeeded) {
      return {
        status: 'failed',
        redirectUrl: this.vnpayClientReturnUrl(attempt.contractId, 'failed'),
      }
    }
    if (attempt.status === 'succeeded') {
      return {
        status: 'succeeded',
        redirectUrl: this.vnpayClientReturnUrl(attempt.contractId, 'succeeded'),
      }
    }
    if (
      attempt.status !== 'pending' ||
      attempt.expiresAt.getTime() < Date.now()
    ) {
      throw new ConflictException('PAYMENT_ATTEMPT_NOT_PENDING')
    }
    await this.settleDepositAttempt(
      attempt,
      this.vnpayCallbackDigest(query),
      this.vnpaySecret()
    )
    return {
      status: 'succeeded',
      redirectUrl: this.vnpayClientReturnUrl(attempt.contractId, 'succeeded'),
    }
  }

  async handleRentCallback(
    body: PaymentCallbackDto,
    headers: CallbackHeaders
  ): Promise<MockPaymentCallbackResult> {
    this.assertMockProvider()
    const attempt = await this.verifyCallback(body, headers, 'rent')
    if (attempt.status === 'succeeded') {
      return { status: 'succeeded', txRef: attempt.txRef, replayed: true }
    }
    attempt.status = 'succeeded'
    attempt.processedAt = new Date()
    attempt.callbackDigest = this.callbackDigest(body, headers)
    await this.attemptRepository.save(attempt)

    const payment = await this.paymentRepository.findOne({
      where: { _id: new ObjectId(attempt.paymentId) },
    })
    if (!payment) throw new NotFoundException('PAYMENT_NOT_FOUND')
    payment.status = 'paid'
    payment.paidAt = new Date()
    payment.txRef = attempt.txRef
    Object.assign(
      payment,
      this.createReceipt(
        payment._id.toHexString(),
        payment.contractId,
        payment.type ?? 'rent',
        payment.amount,
        payment.vatAmount ?? 0,
        payment.paidAt,
        attempt.txRef
      )
    )
    payment.paymentHash = this.receiptHash({
      type: 'rent',
      paymentId: payment._id.toString(),
      contractId: payment.contractId,
      txRef: attempt.txRef,
      amount: payment.amount,
    })
    payment.ledgerStatus = 'pending'
    await this.paymentRepository.save(payment)
    await this.enqueuePaymentLedgerEvent(payment)
    await this.recordTransactionEvent({
      transactionKey: payment.contractId ?? payment._id.toHexString(),
      contractId: payment.contractId,
      eventType: 'payment.succeeded',
      actorRole: 'provider',
      refs: { paymentId: payment._id.toHexString() },
      transitionKey: `payment:${attempt._id.toHexString()}:succeeded`,
    })
    return { status: 'succeeded', txRef: attempt.txRef, replayed: false }
  }

  async handleSettlementCallback(
    body: PaymentCallbackDto,
    headers: CallbackHeaders
  ): Promise<MockPaymentCallbackResult> {
    this.assertMockProvider()
    const attempt = await this.verifyCallback(body, headers, 'settlement')
    if (attempt.status === 'succeeded') {
      return { status: 'succeeded', txRef: attempt.txRef, replayed: true }
    }
    const settlement = await this.findSettlement(attempt.paymentId)
    const paidAt = new Date()
    const paymentIds = attempt.paymentIds ?? []
    for (const paymentId of paymentIds) {
      const payment = await this.findPayment(paymentId)
      if (payment.status === 'paid' || payment.status === 'waived') continue
      payment.status = 'paid'
      payment.paidAt = paidAt
      payment.txRef = attempt.txRef
      Object.assign(
        payment,
        this.createReceipt(
          payment._id.toHexString(),
          payment.contractId,
          payment.type ?? 'rent',
          payment.amount,
          payment.vatAmount ?? 0,
          paidAt,
          attempt.txRef
        )
      )
      payment.paymentHash = this.receiptHash({
        type: payment.type ?? 'rent',
        paymentId: payment._id.toHexString(),
        contractId: payment.contractId,
        txRef: attempt.txRef,
        amount: payment.amount,
      })
      payment.ledgerStatus = 'pending'
      await this.paymentRepository.save(payment)
      await this.enqueuePaymentLedgerEvent(payment)
    }
    settlement.lines = settlement.lines.map(line =>
      line.paymentId && paymentIds.includes(line.paymentId) && !line.paidAt
        ? { ...line, paidAt }
        : line
    )
    settlement.status = settlement.lines.every(line => Boolean(line.paidAt))
      ? 'paid'
      : 'partially-paid'
    await this.settlementRepository.save(settlement)
    attempt.status = 'succeeded'
    attempt.processedAt = paidAt
    attempt.callbackDigest = this.callbackDigest(body, headers)
    await this.attemptRepository.save(attempt)
    await this.recordTransactionEvent({
      transactionKey: settlement.contractId ?? settlement._id.toHexString(),
      contractId: settlement.contractId ?? null,
      eventType: 'payment.succeeded',
      actorRole: 'provider',
      refs: { settlementId: settlement._id.toHexString() },
      transitionKey: `payment:${attempt._id.toHexString()}:succeeded`,
    })
    return { status: 'succeeded', txRef: attempt.txRef, replayed: false }
  }

  async handleInvoiceCallback(
    body: PaymentCallbackDto,
    headers: CallbackHeaders
  ): Promise<MockPaymentCallbackResult> {
    this.assertMockProvider()
    const attempt = await this.verifyCallback(body, headers, 'invoice')
    if (attempt.status === 'succeeded') {
      return { status: 'succeeded', txRef: attempt.txRef, replayed: true }
    }
    const payment = await this.findPayment(attempt.paymentId)
    if (payment.status !== 'paid' && payment.status !== 'waived') {
      payment.status = 'paid'
      payment.paidAt = new Date()
      payment.txRef = attempt.txRef
      Object.assign(
        payment,
        this.createReceipt(
          payment._id.toHexString(),
          payment.contractId,
          payment.type ?? 'platform-fee',
          payment.amount,
          payment.vatAmount ?? 0,
          payment.paidAt,
          attempt.txRef
        )
      )
      payment.paymentHash = this.receiptHash({
        type: payment.type ?? 'platform-fee',
        paymentId: payment._id.toHexString(),
        contractId: payment.contractId,
        txRef: attempt.txRef,
        amount: payment.amount,
      })
      payment.ledgerStatus = 'pending'
      await this.paymentRepository.save(payment)
      await this.enqueuePaymentLedgerEvent(payment)
    }
    attempt.status = 'succeeded'
    attempt.processedAt = new Date()
    attempt.callbackDigest = this.callbackDigest(body, headers)
    await this.attemptRepository.save(attempt)
    await this.recordTransactionEvent({
      transactionKey: payment.contractId ?? payment._id.toHexString(),
      contractId: payment.contractId,
      eventType: 'payment.succeeded',
      actorRole: 'provider',
      refs: { paymentId: payment._id.toHexString() },
      transitionKey: `payment:${attempt._id.toHexString()}:succeeded`,
    })
    return { status: 'succeeded', txRef: attempt.txRef, replayed: false }
  }

  async getWallet(userId: string): Promise<{
    userId: string
    provider: PaymentProviderName
    externalAccountRef: string
    status: 'linked' | 'unlinked'
    simulation: boolean
    balance: null
  }> {
    this.assertMockProvider()
    const wallet = await this.walletRepository.findOne({ where: { userId } })
    if (wallet) {
      return {
        userId,
        provider: wallet.provider,
        externalAccountRef: wallet.externalAccountRef,
        status: wallet.status,
        simulation: wallet.simulation,
        balance: null,
      }
    }
    return this.linkWallet(userId)
  }

  async linkWallet(userId: string): Promise<{
    userId: string
    provider: PaymentProviderName
    externalAccountRef: string
    status: 'linked' | 'unlinked'
    simulation: boolean
    balance: null
  }> {
    this.assertMockProvider()
    const existing = await this.walletRepository.findOne({ where: { userId } })
    if (existing) {
      return {
        userId,
        provider: existing.provider,
        externalAccountRef: existing.externalAccountRef,
        status: existing.status,
        simulation: existing.simulation,
        balance: null,
      }
    }
    const accountLink = await this.providerRegistry.getAccountLink(userId)
    const created = await this.walletRepository.save(
      this.walletRepository.create({
        userId,
        provider: accountLink.provider,
        externalAccountRef: accountLink.externalAccountRef,
        status: accountLink.status,
        simulation: accountLink.simulation,
      })
    )
    return {
      userId,
      provider: created.provider,
      externalAccountRef: created.externalAccountRef,
      status: created.status,
      simulation: created.simulation,
      balance: null,
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
      attempt.status = 'expired'
      await this.attemptRepository.save(attempt)
      await this.recordTransactionEvent({
        transactionKey: attempt.contractId ?? attempt.paymentId,
        contractId: attempt.contractId ?? null,
        eventType: 'payment-attempt.expired',
        actorRole: 'system',
        refs: { paymentId: attempt.paymentId },
        transitionKey: `payment-attempt:${attempt._id.toHexString()}:expired`,
      })
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

  private async createAttempt(
    userId: string,
    amount: number,
    description: string,
    paymentId: string,
    paymentType: 'deposit' | 'rent' | 'settlement' | 'invoice',
    contractId: string | null = null,
    paymentIds: string[] | null = null
  ): Promise<MockPaymentInit> {
    const txRef = `${this.providerRegistry.providerName().toUpperCase()}-${randomBytes(12).toString('hex')}`
    const intent = await this.providerRegistry.createPaymentIntent({
      amount,
      description,
      customerRef: userId,
      txRef,
    })
    const attempt = this.attemptRepository.create({
      provider: intent.provider,
      txRef: intent.txRef,
      paymentId,
      paymentIds,
      contractId,
      paymentType,
      userId,
      amount,
      status: 'pending',
      expiresAt: intent.expiresAt,
      processedAt: null,
      callbackDigest: null,
      providerPaymentUrl: intent.redirectUrl,
    })
    await this.attemptRepository.save(attempt)
    await this.recordTransactionEvent({
      transactionKey: contractId ?? paymentId,
      contractId,
      eventType: 'payment-attempt.created',
      actorRole: 'tenant',
      actorId: userId,
      refs: { paymentId },
      transitionKey: `payment-attempt:${attempt._id.toHexString()}:created`,
    })
    return this.toPaymentInit(attempt, description, intent.redirectUrl)
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

  private receiptHash(payload: Record<string, string | number>): string {
    return createHmac('sha256', this.secret())
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

  private assertMockProvider(): void {
    this.providerRegistry.assertMockProvider()
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
  }

  private vnpaySecret(): string {
    return this.configService.getOrThrow<string>('rentalFlow.vnpayHashSecret')
  }

  private vnpayCallbackDigest(query: VnpayQuery): string {
    return createHash('sha256').update(JSON.stringify(query)).digest('hex')
  }

  private vnpayClientReturnUrl(
    contractId: string | null,
    result: 'succeeded' | 'failed'
  ): string {
    const url = new URL(
      this.configService.getOrThrow<string>('rentalFlow.vnpayClientReturnUrl')
    )
    if (contractId) url.pathname = `/contracts/${contractId}`
    url.searchParams.set('payment', 'vnpay')
    url.searchParams.set('result', result)
    return url.toString()
  }
}
