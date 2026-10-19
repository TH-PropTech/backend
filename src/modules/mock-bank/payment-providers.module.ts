import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { MockBankAdapter } from './providers/mock-bank.adapter'
import { MocbankAdapter } from './providers/mocbank.adapter'
import { MocbankCallbackVerifier } from './providers/mocbank-callback.verifier'
import { MomoAdapter } from './providers/momo.adapter'
import { MomoCallbackVerifier } from './providers/momo-callback.verifier'
import { PaymentProviderRegistry } from './providers/payment-provider.registry'
import { VnpayAdapter } from './providers/vnpay.adapter'
import { VnpayCallbackVerifier } from './providers/vnpay-callback.verifier'
import { ZalopayAdapter } from './providers/zalopay.adapter'
import { ZalopayCallbackVerifier } from './providers/zalopay-callback.verifier'

/**
 * Adapters, verifiers and the registry, split out so PaymentsModule can query
 * gateways without importing MockBankModule (which would close a module cycle).
 */
@Module({
  imports: [ConfigModule],
  providers: [
    MockBankAdapter,
    VnpayAdapter,
    VnpayCallbackVerifier,
    MomoAdapter,
    MomoCallbackVerifier,
    ZalopayAdapter,
    ZalopayCallbackVerifier,
    MocbankAdapter,
    MocbankCallbackVerifier,
    PaymentProviderRegistry,
  ],
  exports: [PaymentProviderRegistry, MocbankCallbackVerifier],
})
export class PaymentProvidersModule {}
