export type PaymentProviderName =
  | 'mock-bank'
  | 'vnpay'
  | 'momo'
  | 'sepay'
  | 'techcombank'

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

/**
 * Boundary for a licensed/approved bank adapter. The platform never owns or
 * debits provider funds; it only stores intent and webhook references.
 */
export interface PaymentProviderAdapter {
  readonly name: PaymentProviderName
  createPaymentIntent(input: {
    amount: number
    description: string
    customerRef: string
  }): Promise<ProviderPaymentIntent>
  getAccountLink(userId: string): Promise<ProviderAccountLink>
}
