import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ContractsModule } from '../contracts/contracts.module'
import { Payment } from '../payments/schemas/payment.schema'
import { PaymentAttempt } from '../payments/schemas/payment-attempt.schema'
import { MockBankController } from './controllers/mock-bank.controller'
import { MockBankService } from './services/mock-bank.service'
import { MockBankAdapter } from './providers/mock-bank.adapter'
import { PaymentProviderRegistry } from './providers/payment-provider.registry'
import { VnpayAdapter } from './providers/vnpay.adapter'
import { VnpayCallbackVerifier } from './providers/vnpay-callback.verifier'
import { MocbankAdapter } from './providers/mocbank.adapter'
import { MocbankCallbackVerifier } from './providers/mocbank-callback.verifier'
import { MomoAdapter } from './providers/momo.adapter'
import { MomoCallbackVerifier } from './providers/momo-callback.verifier'
import { ZalopayAdapter } from './providers/zalopay.adapter'
import { ZalopayCallbackVerifier } from './providers/zalopay-callback.verifier'
import { GatewayCallbackService } from './services/gateway-callback.service'
import { FabricModule } from '../fabric/fabric.module'
import { PaymentRequestsController } from './controllers/payment-requests.controller'
import { MoveInSettlement } from '../rental/schemas/move-in-settlement.schema'
import { WalletsModule } from '../wallets/wallets.module'
import { Contract } from '../contracts/schemas/contract.schema'

@Module({
  imports: [
    ConfigModule,
    ContractsModule,
    FabricModule,
    WalletsModule,
    TypeOrmModule.forFeature([
      Payment,
      PaymentAttempt,
      MoveInSettlement,
      Contract,
    ]),
  ],
  controllers: [MockBankController, PaymentRequestsController],
  providers: [
    MockBankService,
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
    GatewayCallbackService,
  ],
  exports: [MockBankService],
})
export class MockBankModule {}
