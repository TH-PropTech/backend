import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ContractsModule } from '../contracts/contracts.module'
import { Payment } from '../payments/schemas/payment.schema'
import { PaymentAttempt } from '../payments/schemas/payment-attempt.schema'
import { PaymentProvidersModule } from './payment-providers.module'
import { MockBankController } from './controllers/mock-bank.controller'
import { MockBankService } from './services/mock-bank.service'
import { GatewayCallbackService } from './services/gateway-callback.service'
import { FabricModule } from '../fabric/fabric.module'
import { PaymentRequestsController } from './controllers/payment-requests.controller'
import { MoveInSettlement } from '../rental/schemas/move-in-settlement.schema'
import { WalletsModule } from '../wallets/wallets.module'
import { Contract } from '../contracts/schemas/contract.schema'
import { RentalApplication } from '../rental/schemas/rental-application.schema'

@Module({
  imports: [
    ConfigModule,
    PaymentProvidersModule,
    ContractsModule,
    FabricModule,
    WalletsModule,
    TypeOrmModule.forFeature([
      Payment,
      PaymentAttempt,
      MoveInSettlement,
      Contract,
      RentalApplication,
    ]),
  ],
  controllers: [MockBankController, PaymentRequestsController],
  providers: [MockBankService, GatewayCallbackService],
  exports: [MockBankService],
})
export class MockBankModule {}
