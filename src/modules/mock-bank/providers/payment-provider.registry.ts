import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MockBankAdapter } from './mock-bank.adapter'
import type {
  PaymentProviderName,
  ProviderAccountLink,
  ProviderPaymentIntent,
} from './payment-provider.port'

@Injectable()
export class PaymentProviderRegistry {
  constructor(
    private readonly configService: ConfigService,
    private readonly mockBankAdapter: MockBankAdapter
  ) {}

  async createPaymentIntent(input: {
    amount: number
    description: string
    customerRef: string
  }): Promise<ProviderPaymentIntent> {
    return this.activeAdapter().createPaymentIntent(input)
  }

  async getAccountLink(userId: string): Promise<ProviderAccountLink> {
    return this.activeAdapter().getAccountLink(userId)
  }

  assertMockProvider(): void {
    if (this.providerName() !== 'mock-bank') {
      throw new ServiceUnavailableException(
        'BANK_PROVIDER_ADAPTER_NOT_CONFIGURED'
      )
    }
  }

  private activeAdapter(): MockBankAdapter {
    this.assertMockProvider()
    return this.mockBankAdapter
  }

  private providerName(): PaymentProviderName {
    return (
      this.configService.get<PaymentProviderName>(
        'rentalFlow.paymentProvider'
      ) ?? 'mock-bank'
    )
  }
}
