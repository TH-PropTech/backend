import { Injectable } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import type {
  PaymentIntentInput,
  PaymentProviderAdapter,
  ProviderAccountLink,
  ProviderPaymentIntent,
} from './payment-provider.port'

@Injectable()
export class MockBankAdapter implements PaymentProviderAdapter {
  readonly name = 'mock-bank' as const

  newTxRef(): string {
    return `MOCK-BANK-${randomBytes(12).toString('hex')}`
  }

  createPaymentIntent(
    input: PaymentIntentInput
  ): Promise<ProviderPaymentIntent> {
    return Promise.resolve({
      provider: this.name,
      txRef: input.txRef,
      redirectUrl: `mockbank://pay?txRef=${encodeURIComponent(input.txRef)}&amount=${input.amount}`,
      expiresAt: input.expiresAt,
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
