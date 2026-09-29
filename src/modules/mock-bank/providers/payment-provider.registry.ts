import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MockBankAdapter } from './mock-bank.adapter'
import { VnpayAdapter } from './vnpay.adapter'
import type {
  PaymentProviderName,
  ProviderAccountLink,
  ProviderPaymentIntent,
} from './payment-provider.port'

@Injectable()
export class PaymentProviderRegistry {
  constructor(
    private readonly configService: ConfigService,
    private readonly mockBankAdapter: MockBankAdapter,
    private readonly vnpayAdapter: VnpayAdapter
  ) {}

  async createPaymentIntent(input: {
    amount: number
    description: string
    customerRef: string
    txRef: string
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

  assertVnpayProvider(): void {
    if (this.providerName() !== 'vnpay') {
      throw new ServiceUnavailableException('VNPAY_PROVIDER_NOT_CONFIGURED')
    }
  }

  private activeAdapter(): MockBankAdapter | VnpayAdapter {
    switch (this.providerName()) {
      case 'mock-bank':
        return this.mockBankAdapter
      case 'vnpay':
        return this.vnpayAdapter
      default:
        throw new ServiceUnavailableException(
          'BANK_PROVIDER_ADAPTER_NOT_CONFIGURED'
        )
    }
  }

  providerName(): PaymentProviderName {
    return (
      this.configService.get<PaymentProviderName>(
        'rentalFlow.paymentProvider'
      ) ?? 'mock-bank'
    )
  }
}
