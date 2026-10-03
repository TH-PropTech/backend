export type PaymentProviderName =
  | 'mock-bank'
  | 'vnpay'
  | 'momo'
  | 'zalopay'
  | 'sepay'
  | 'techcombank'

/** External gateways that authenticate their own callbacks. */
export type GatewayProviderName = 'vnpay' | 'momo' | 'zalopay'

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
}

/**
 * Boundary for a licensed/approved bank adapter. The platform never owns or
 * debits provider funds; it only stores intent and webhook references.
 */
export interface PaymentProviderAdapter {
  readonly name: PaymentProviderName
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
    expected: { txRef: string; amount: number }
  ): GatewayVerdict
}
