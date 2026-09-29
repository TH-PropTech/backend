import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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

@Injectable()
export class MockBankService {
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
    private readonly vnpayCallbackVerifier: VnpayCallbackVerifier
  ) {}

  async initDepositPayment(
    depositAgreementId: string,
    currentUserId: string
  ): Promise<MockPaymentInit> {
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
          return this.toPaymentInit(
            existingAttempt,
            `Deposit ${agreement.agreementCode}`
          )
        }
        existingAttempt.status = 'expired'
        await this.attemptRepository.save(existingAttempt)
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
    return result
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
    payment.paymentHash = this.receiptHash({
      type: 'rent',
      paymentId: payment._id.toString(),
      contractId: payment.contractId,
      txRef: attempt.txRef,
      amount: payment.amount,
    })
    payment.ledgerStatus = 'pending'
    await this.paymentRepository.save(payment)
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
    return attempt.paymentType === 'deposit'
      ? this.handleDepositCallback(body, headers)
      : this.handleRentCallback(body, headers)
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
    paymentType: 'deposit' | 'rent',
    contractId: string | null = null
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

  private async verifyCallback(
    body: PaymentCallbackDto,
    headers: CallbackHeaders,
    expectedType: 'deposit' | 'rent'
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

  private receiptHash(payload: Record<string, string | number>): string {
    return createHmac('sha256', this.secret())
      .update(JSON.stringify(payload))
      .digest('hex')
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
    const agreement = await this.depositAgreementsService.recordDepositPaid(
      attempt.paymentId,
      attempt._id.toString(),
      depositHash
    )
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
