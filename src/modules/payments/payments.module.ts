import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Payment } from './schemas/payment.schema'
import { PaymentAttempt } from './schemas/payment-attempt.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { FabricModule } from '../fabric/fabric.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, PaymentAttempt, Contract]),
    NotificationsModule,
    FabricModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [TypeOrmModule, PaymentsService],
})
export class PaymentsModule {}
