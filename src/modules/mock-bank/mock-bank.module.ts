import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ContractsModule } from '../contracts/contracts.module'
import { Payment } from '../payments/schemas/payment.schema'
import { PaymentAttempt } from '../payments/schemas/payment-attempt.schema'
import { MockBankController } from './mock-bank.controller'
import { MockBankService } from './mock-bank.service'
import { MockWallet } from './schemas/mock-wallet.schema'
import { MockBankAdapter } from './providers/mock-bank.adapter'
import { PaymentProviderRegistry } from './providers/payment-provider.registry'
import { VnpayAdapter } from './providers/vnpay.adapter'
import { VnpayCallbackVerifier } from './providers/vnpay-callback.verifier'
import { FabricModule } from '../fabric/fabric.module'
import { PaymentRequestsController } from './payment-requests.controller'
import { MoveInSettlement } from '../move-in-settlements/schemas/move-in-settlement.schema'

@Module({
  imports: [
    ConfigModule,
    ContractsModule,
    FabricModule,
    TypeOrmModule.forFeature([
      Payment,
      PaymentAttempt,
      MockWallet,
      MoveInSettlement,
    ]),
  ],
  controllers: [MockBankController, PaymentRequestsController],
  providers: [
    MockBankService,
    MockBankAdapter,
    VnpayAdapter,
    VnpayCallbackVerifier,
    PaymentProviderRegistry,
  ],
  exports: [MockBankService],
})
export class MockBankModule {}
