import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { MockBankAdapter } from '../mock-bank/providers/mock-bank.adapter'
import { MocbankAdapter } from '../mock-bank/providers/mocbank.adapter'
import { MocbankCallbackVerifier } from '../mock-bank/providers/mocbank-callback.verifier'
import { MomoAdapter } from '../mock-bank/providers/momo.adapter'
import { MomoCallbackVerifier } from '../mock-bank/providers/momo-callback.verifier'
import { PaymentProviderRegistry } from '../mock-bank/providers/payment-provider.registry'
import { ZalopayAdapter } from '../mock-bank/providers/zalopay.adapter'
import { ZalopayCallbackVerifier } from '../mock-bank/providers/zalopay-callback.verifier'

/**
 * Adapters, verifiers and the registry, split out so PaymentsModule can query
 * gateways without importing MockBankModule (which would close a module cycle).
 */
@Module({
  imports: [ConfigModule],
  providers: [
    MockBankAdapter,
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
