import type { PaymentClientChannel } from '../../payments/schemas/payment-attempt.schema'

export type PaymentProviderName =
  | 'mock-bank'
  | 'vnpay'
  | 'momo'
  | 'zalopay'
  | 'mocbank'
  | 'sepay'
  | 'techcombank'

/** How the tenant pays inside MoMo: wallet/QR, domestic ATM card, intl card. */
export const MOMO_PAYMENT_METHODS = ['wallet', 'atm', 'card'] as const
export type MomoPaymentMethod = (typeof MOMO_PAYMENT_METHODS)[number]

/** External gateways that authenticate their own callbacks. */
export type GatewayProviderName = 'vnpay' | 'momo' | 'zalopay' | 'mocbank'

export type ProviderPaymentIntent = {
  provider: PaymentProviderName
  txRef: string
  redirectUrl: string
  expiresAt: Date
}

export type ProviderAccountLink = {
  provider: PaymentProviderName
  externalAccountRef: string
  status: 'linked' | 'unlinked'
  simulation: boolean
}

export type PaymentIntentInput = {
  amount: number
  description: string
  customerRef: string
  txRef: string
  expiresAt: Date
  clientIp?: string | undefined
  /** MoMo only; other adapters ignore it. Defaults to `wallet`. */
  momoMethod?: MomoPaymentMethod | undefined
  /** Ví Mộc only; other adapters ignore it. Defaults to `web`. */
  clientChannel?: PaymentClientChannel | undefined
  /** Ví Mộc only: tài khoản nhận tiền thay cho ví của sàn (chủ nhà). */
  payeeAccountNumber?: string | undefined
}

/**
 * Boundary for a licensed/approved bank adapter. The platform never owns or
 * debits provider funds; it only stores intent and webhook references.
 */
export type GatewayQueryState =
  | 'succeeded'
  | 'pending'
  | 'failed'
  | 'not_found'
  | 'unavailable'

export type GatewayQueryInput = {
  txRef: string
  providerTransactionId?: string | null | undefined
  amount: number
  /** When the attempt (and so the gateway order) was created. */
  createdAt: Date
}

/** Result of asking the gateway itself about an order. Never throws. */
export type GatewayQueryResult = {
  state: GatewayQueryState
  providerTransactionId: string | null
  /** VND amount reported by the gateway; null when it did not report one. */
  amount: number | null
  rawCode: string | null
  message: string | null
}

export interface PaymentProviderAdapter {
  readonly name: PaymentProviderName
  /**
   * Optional read-only reconciliation against the gateway's own query API.
   * Implementations must never throw and never move money.
   */
  queryStatus?(input: GatewayQueryInput): Promise<GatewayQueryResult>
  /** Server-generated reference in the format the provider accepts. */
  newTxRef(): string
  createPaymentIntent(input: PaymentIntentInput): Promise<ProviderPaymentIntent>
  getAccountLink(userId: string): Promise<ProviderAccountLink>
}

/** Callback channel: server-to-server notify (IPN) or browser return. */
export type GatewayCallbackKind = 'notify' | 'return'

export type GatewayVerdict = {
  txRef: string
  amount: number
  succeeded: boolean
  providerTransactionId: string | null
}

export type GatewayFailureReason =
  | 'invalid-payload'
  | 'invalid-signature'
  | 'merchant-mismatch'
  | 'unknown-reference'
  | 'amount-mismatch'
  | 'payee-mismatch'

/** Raised by verifiers; carries no payload data so it is safe to log. */
export class GatewayVerificationError extends Error {
  constructor(readonly reason: GatewayFailureReason) {
    super(`GATEWAY_${reason.toUpperCase().replace(/-/g, '_')}`)
    this.name = 'GatewayVerificationError'
  }
}

export interface GatewayVerifier {
  readonly name: GatewayProviderName
  /** Reference used only to look up the attempt; not trusted until verify(). */
  extractTxRef(payload: unknown, kind: GatewayCallbackKind): string | null
  verify(
    payload: unknown,
    kind: GatewayCallbackKind,
    expected: {
      txRef: string
      amount: number
      /** Tài khoản nhận đã gắn vào lần thử; null/undefined khi tiền vào ví của sàn. */
      payeeAccountNumber?: string | null | undefined
    }
  ): GatewayVerdict | Promise<GatewayVerdict>
}
