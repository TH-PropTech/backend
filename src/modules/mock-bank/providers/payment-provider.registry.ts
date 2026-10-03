import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { SelectablePaymentProvider } from '../../../config/configuration'
import { MockBankAdapter } from './mock-bank.adapter'
import {
  MOMO_METHOD_OPTIONS,
  MomoAdapter,
  type MomoMethodOption,
} from './momo.adapter'
import { MomoCallbackVerifier } from './momo-callback.verifier'
import type {
  GatewayProviderName,
  GatewayVerifier,
  PaymentProviderAdapter,
  PaymentProviderName,
  ProviderAccountLink,
} from './payment-provider.port'
import { VnpayAdapter } from './vnpay.adapter'
import { VnpayCallbackVerifier } from './vnpay-callback.verifier'
import { ZalopayAdapter } from './zalopay.adapter'
import { ZalopayCallbackVerifier } from './zalopay-callback.verifier'

export type PaymentProviderOption = {
  provider: SelectablePaymentProvider
  label: string
  simulation: boolean
  /** MoMo only: payment methods with their VND limits. */
  methods?: MomoMethodOption[]
}

const PROVIDER_LABELS: Record<SelectablePaymentProvider, string> = {
  'mock-bank': 'Mock Bank (sandbox)',
  vnpay: 'VNPAY',
  momo: 'MoMo',
  zalopay: 'ZaloPay',
}

@Injectable()
export class PaymentProviderRegistry {
  private readonly adapters: Record<
    SelectablePaymentProvider,
    PaymentProviderAdapter
  >
  private readonly verifiers: Record<GatewayProviderName, GatewayVerifier>

  constructor(
    private readonly configService: ConfigService,
    mockBankAdapter: MockBankAdapter,
    vnpayAdapter: VnpayAdapter,
    momoAdapter: MomoAdapter,
    zalopayAdapter: ZalopayAdapter,
    vnpayVerifier: VnpayCallbackVerifier,
    momoVerifier: MomoCallbackVerifier,
    zalopayVerifier: ZalopayCallbackVerifier
  ) {
    this.adapters = {
      'mock-bank': mockBankAdapter,
      vnpay: vnpayAdapter,
      momo: momoAdapter,
      zalopay: zalopayAdapter,
    }
    this.verifiers = {
      vnpay: vnpayVerifier,
      momo: momoVerifier,
      zalopay: zalopayVerifier,
    }
  }

  enabledProviders(): SelectablePaymentProvider[] {
    const enabled = this.configService.get<SelectablePaymentProvider[]>(
      'rentalFlow.payments.enabledProviders'
    )
    return enabled?.length ? enabled : ['mock-bank']
  }

  defaultProvider(): SelectablePaymentProvider {
    return this.enabledProviders()[0] ?? 'mock-bank'
  }

  isEnabled(name: PaymentProviderName): name is SelectablePaymentProvider {
    return (this.enabledProviders() as PaymentProviderName[]).includes(name)
  }

  /** Adapter for a new attempt; fails closed for anything not allow-listed. */
  get(
    name: PaymentProviderName = this.defaultProvider()
  ): PaymentProviderAdapter {
    if (!this.isEnabled(name)) {
      throw new BadRequestException('PAYMENT_PROVIDER_NOT_ENABLED')
    }
    return this.adapters[name]
  }

  /**
   * Verifier for an existing attempt's provider. Deliberately not gated by
   * the allow-list so attempts created before a rollback can still settle.
   */
  verifierFor(name: GatewayProviderName): GatewayVerifier {
    return this.verifiers[name]
  }

  listProviders(): PaymentProviderOption[] {
    return this.enabledProviders().map(provider => ({
      provider,
      label: PROVIDER_LABELS[provider],
      simulation: provider === 'mock-bank',
      ...(provider === 'momo' ? { methods: MOMO_METHOD_OPTIONS } : {}),
    }))
  }

  getAccountLink(userId: string): Promise<ProviderAccountLink> {
    return this.get().getAccountLink(userId)
  }
}
