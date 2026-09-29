import { Injectable } from '@nestjs/common'
import type {
  PaymentProviderAdapter,
  ProviderAccountLink,
  ProviderPaymentIntent,
} from './payment-provider.port'

@Injectable()
export class MockBankAdapter implements PaymentProviderAdapter {
  readonly name = 'mock-bank' as const

  createPaymentIntent(input: {
    amount: number
    description: string
    customerRef: string
    txRef: string
  }): Promise<ProviderPaymentIntent> {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    return Promise.resolve({
      provider: this.name,
      txRef: input.txRef,
      redirectUrl: `mockbank://pay?txRef=${encodeURIComponent(input.txRef)}&amount=${input.amount}`,
      expiresAt,
    })
  }

  getAccountLink(userId: string): Promise<ProviderAccountLink> {
    return Promise.resolve({
      provider: this.name,
      externalAccountRef: `mock-account:${userId}`,
      status: 'linked',
      simulation: true,
    })
  }
}
