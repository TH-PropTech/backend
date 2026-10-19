import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Payment } from './schemas/payment.schema'
import { PaymentAttempt } from './schemas/payment-attempt.schema'
import { SystemConfig } from '../properties/schemas/system-config.schema'
import { PlatformFeeScheduleRepository } from './utils/platform-fee-schedule.repository'
import { Contract } from '../contracts/schemas/contract.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { User } from '../users/schemas/user.schema'
import { Payout } from '../wallets/schemas/payout.schema'
import { PaymentsController } from './controllers/payments.controller'
import { PlatformFeesController } from './controllers/platform-fees.controller'
import { AdminPaymentsController } from './controllers/admin-payments.controller'
import { PaymentsService } from './services/payments.service'
import { PlatformFeesService } from './services/platform-fees.service'
import { AdminPaymentsService } from './services/admin-payments.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { FabricModule } from '../fabric/fabric.module'
import { WalletsModule } from '../wallets/wallets.module'
import { ActivityLogModule } from '../activity-log/activity-log.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      PaymentAttempt,
      Contract,
      SystemConfig,
      DepositAgreement,
      User,
      Payout,
    ]),
    NotificationsModule,
    FabricModule,
    WalletsModule,
    ActivityLogModule,
  ],
  controllers: [
    PaymentsController,
    PlatformFeesController,
    AdminPaymentsController,
  ],
  providers: [
    PaymentsService,
    PlatformFeesService,
    PlatformFeeScheduleRepository,
    AdminPaymentsService,
  ],
  exports: [TypeOrmModule, PaymentsService, PlatformFeesService],
})
export class PaymentsModule {}
