import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Payment } from './schemas/payment.schema'
import { PaymentAttempt } from './schemas/payment-attempt.schema'
import { PlatformFeeAudit } from './schemas/platform-fee-audit.schema'
import { PlatformFeeSchedule } from './schemas/platform-fee-schedule.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { PaymentsController } from './controllers/payments.controller'
import { PlatformFeesController } from './controllers/platform-fees.controller'
import { PaymentsService } from './services/payments.service'
import { PlatformFeesService } from './services/platform-fees.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { FabricModule } from '../fabric/fabric.module'
import { WalletsModule } from '../wallets/wallets.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      PaymentAttempt,
      Contract,
      PlatformFeeSchedule,
      PlatformFeeAudit,
    ]),
    NotificationsModule,
    FabricModule,
    WalletsModule,
  ],
  controllers: [PaymentsController, PlatformFeesController],
  providers: [PaymentsService, PlatformFeesService],
  exports: [TypeOrmModule, PaymentsService, PlatformFeesService],
})
export class PaymentsModule {}
