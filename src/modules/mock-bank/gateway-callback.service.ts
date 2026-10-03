import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { Repository } from 'typeorm'
import type { PaymentsConfig } from '../../config/configuration'
import { PaymentAttempt } from '../payments/schemas/payment-attempt.schema'
import { MockBankService, type SettlementOutcome } from './mock-bank.service'
import { PaymentProviderRegistry } from './providers/payment-provider.registry'
import {
  GatewayVerificationError,
  type GatewayCallbackKind,
  type GatewayFailureReason,
  type GatewayProviderName,
} from './providers/payment-provider.port'

export type GatewayCallbackResult =
  | { ok: true; outcome: SettlementOutcome; attempt: PaymentAttempt }
  | {
      ok: false
      reason: GatewayFailureReason | 'internal-error'
      attempt: PaymentAttempt | null
    }

export type VnpayIpnAck = { RspCode: string; Message: string }
export type ZalopayCallbackAck = { return_code: number; return_message: string }

const SUCCESS_OUTCOMES: SettlementOutcome[] = [
  'settled',
  'replayed',
  'duplicate-paid',
]

/**
 * Verifies VNPAY / MoMo / ZaloPay notify + browser-return payloads against
 * the stored attempt and hands verified results to the single settlement
 * dispatcher. Never logs payload contents, keys or signatures.
 */
@Injectable()
export class GatewayCallbackService {
  private readonly logger = new Logger(GatewayCallbackService.name)

  constructor(
    @InjectRepository(PaymentAttempt)
    private readonly attemptRepository: Repository<PaymentAttempt>,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly mockBankService: MockBankService,
    private readonly configService: ConfigService
  ) {}

  async handleNotify(
    provider: GatewayProviderName,
    payload: unknown
  ): Promise<GatewayCallbackResult> {
    return this.process(provider, payload, 'notify')
  }

  /** Returns the client URL to 302 to; built only from server config. */
  async handleReturn(
    provider: GatewayProviderName,
    payload: unknown
  ): Promise<string> {
    const result = await this.process(provider, payload, 'return')
    const succeeded = result.ok && SUCCESS_OUTCOMES.includes(result.outcome)
    return this.clientRedirectUrl(
      result.attempt,
      provider,
      succeeded ? 'succeeded' : 'failed',
      result.ok
    )
  }

  toVnpayAck(result: GatewayCallbackResult): VnpayIpnAck {
    if (result.ok) {
      return result.outcome === 'replayed'
        ? { RspCode: '02', Message: 'Order already confirmed' }
        : { RspCode: '00', Message: 'Confirm Success' }
    }
    switch (result.reason) {
      case 'invalid-signature':
        return { RspCode: '97', Message: 'Invalid signature' }
      case 'unknown-reference':
      case 'merchant-mismatch':
        return { RspCode: '01', Message: 'Order not found' }
      case 'amount-mismatch':
        return { RspCode: '04', Message: 'Invalid amount' }
      default:
        return { RspCode: '99', Message: 'Unknown error' }
    }
  }

  /** MoMo IPN: 204 on handled results, 400 on rejected payloads, 500 to retry. */
  toMomoStatus(result: GatewayCallbackResult): number {
    if (result.ok) return 204
    return result.reason === 'internal-error' ? 500 : 400
  }

  toZalopayAck(result: GatewayCallbackResult): ZalopayCallbackAck {
    if (result.ok) {
      return result.outcome === 'replayed'
        ? { return_code: 2, return_message: 'already processed' }
        : { return_code: 1, return_message: 'success' }
    }
    if (result.reason === 'invalid-signature') {
      return { return_code: -1, return_message: 'mac not equal' }
    }
    // 0 asks ZaloPay to retry the callback later.
    return { return_code: 0, return_message: result.reason }
  }

  private async process(
    provider: GatewayProviderName,
    payload: unknown,
    kind: GatewayCallbackKind
  ): Promise<GatewayCallbackResult> {
    const verifier = this.providerRegistry.verifierFor(provider)
    const txRef = verifier.extractTxRef(payload, kind)
    if (!txRef) return this.reject(provider, kind, 'invalid-payload', null)
    const attempt = await this.attemptRepository.findOne({ where: { txRef } })
    // An attempt is only ever verified with its own provider's scheme.
    if (!attempt || attempt.provider !== provider) {
      return this.reject(provider, kind, 'unknown-reference', null, txRef)
    }
    try {
      const verdict = verifier.verify(payload, kind, {
        txRef: attempt.txRef,
        amount: attempt.amount,
      })
      const outcome = await this.mockBankService.settleVerifiedAttempt(
        attempt,
        verdict,
        createHash('sha256').update(JSON.stringify(payload)).digest('hex')
      )
      this.logger.log(
        `${provider} ${kind} txRef=${attempt.txRef} outcome=${outcome}`
      )
      return { ok: true, outcome, attempt }
    } catch (error) {
      if (error instanceof GatewayVerificationError) {
        return this.reject(provider, kind, error.reason, attempt, txRef)
      }
      this.logger.error(
        `${provider} ${kind} settlement failed txRef=${attempt.txRef}: ${error instanceof Error ? error.message : 'unknown'}`
      )
      return { ok: false, reason: 'internal-error', attempt }
    }
  }

  private reject(
    provider: GatewayProviderName,
    kind: GatewayCallbackKind,
    reason: GatewayFailureReason,
    attempt: PaymentAttempt | null,
    txRef?: string
  ): GatewayCallbackResult {
    this.logger.warn(
      `${provider} ${kind} rejected reason=${reason} txRef=${txRef ?? 'none'}`
    )
    return { ok: false, reason, attempt }
  }

  private clientRedirectUrl(
    attempt: PaymentAttempt | null,
    provider: GatewayProviderName,
    status: 'succeeded' | 'failed',
    verified: boolean
  ): string {
    const payments = this.configService.getOrThrow<PaymentsConfig>(
      'rentalFlow.payments'
    )
    if (attempt?.clientChannel === 'mobile') {
      const url = new URL(payments.mobileReturnUrl)
      url.searchParams.set('status', status)
      url.searchParams.set('txRef', attempt.txRef)
      return url.toString()
    }
    const url = new URL(payments.clientReturnUrl)
    url.pathname = attempt?.contractId
      ? `/contracts/${encodeURIComponent(attempt.contractId)}`
      : '/payments'
    url.searchParams.set('payment', status)
    url.searchParams.set('provider', provider)
    if (verified && attempt && !attempt.contractId) {
      url.searchParams.set('txRef', attempt.txRef)
    }
    return url.toString()
  }
}
