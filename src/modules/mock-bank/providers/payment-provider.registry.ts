import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { SelectablePaymentProvider } from '../../../config/configuration'
import type { WalletBrand } from '../../wallets/utils/supported-banks'
import { MockBankAdapter } from './mock-bank.adapter'
import { MocbankAdapter } from './mocbank.adapter'
import { MocbankCallbackVerifier } from './mocbank-callback.verifier'
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
import {
  ZALOPAY_METHOD_OPTIONS,
  ZalopayAdapter,
  type ZalopayMethodOption,
} from './zalopay.adapter'
import { ZalopayCallbackVerifier } from './zalopay-callback.verifier'

export type PaymentProviderOption = {
  provider: SelectablePaymentProvider
  label: string
  simulation: boolean
  /** MoMo only: payment methods with their VND limits. */
  methods?: MomoMethodOption[] | ZalopayMethodOption[]
  /** Ví Mộc only: wallet brands the payer can route the landlord payout to. */
  brands?: Array<{ brand: WalletBrand; label: string }>
}

const MOCBANK_BRAND_OPTIONS: Array<{ brand: WalletBrand; label: string }> = [
  { brand: 'mocbank', label: 'Ví Mộc' },
  { brand: 'momo', label: 'Momo (mô phỏng)' },
  { brand: 'zalopay', label: 'ZaloPay (mô phỏng)' },
]

const PROVIDER_LABELS: Record<SelectablePaymentProvider, string> = {
  'mock-bank': 'Mock Bank (sandbox)',
  momo: 'MoMo',
  zalopay: 'ZaloPay',
  mocbank: 'Ví Mộc (sandbox)',
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
    momoAdapter: MomoAdapter,
    zalopayAdapter: ZalopayAdapter,
    mocbankAdapter: MocbankAdapter,
    momoVerifier: MomoCallbackVerifier,
    zalopayVerifier: ZalopayCallbackVerifier,
    mocbankVerifier: MocbankCallbackVerifier
  ) {
    this.adapters = {
      'mock-bank': mockBankAdapter,
      momo: momoAdapter,
      zalopay: zalopayAdapter,
      mocbank: mocbankAdapter,
    }
    this.verifiers = {
      momo: momoVerifier,
      zalopay: zalopayVerifier,
      mocbank: mocbankVerifier,
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
   * Adapter for read-only reconciliation of an existing attempt. Deliberately
   * not gated by the allow-list (like verifierFor): a provider disabled for
   * new payments can still be queried for attempts already made.
   */
  getForQuery(name: PaymentProviderName): PaymentProviderAdapter | null {
    return (
      (this.adapters as Partial<Record<string, PaymentProviderAdapter>>)[
        name
      ] ?? null
    )
  }

  /**
   * Verifier for an existing attempt's provider. Deliberately not gated by
   * the allow-list so attempts created before a rollback can still settle.
   */
  verifierFor(name: GatewayProviderName): GatewayVerifier {
    return this.verifiers[name]
  }

  /**
   * `purpose` 'invoice' (phí hoa hồng nền tảng) chỉ cho phép Ví Mộc; các purpose
   * khác liệt kê mọi provider đang bật.
   */
  listProviders(purpose?: 'deposit' | 'invoice'): PaymentProviderOption[] {
    const enabled = this.enabledProviders()
    const providers =
      purpose === 'invoice'
        ? enabled.filter(provider => provider === 'mocbank')
        : enabled
    return providers.map(provider => ({
      provider,
      label: PROVIDER_LABELS[provider],
      simulation: provider === 'mock-bank',
      ...(provider === 'momo' ? { methods: MOMO_METHOD_OPTIONS } : {}),
      ...(provider === 'zalopay' ? { methods: ZALOPAY_METHOD_OPTIONS } : {}),
      ...(provider === 'mocbank' ? { brands: MOCBANK_BRAND_OPTIONS } : {}),
    }))
  }

  getAccountLink(userId: string): Promise<ProviderAccountLink> {
    return this.get().getAccountLink(userId)
  }
}
