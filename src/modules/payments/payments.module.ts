import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Payment } from './schemas/payment.schema'
import { PaymentAttempt } from './schemas/payment-attempt.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { FabricModule } from '../fabric/fabric.module'
import { PropertyOwnershipTransferModule } from '../property-ownership-transfer/property-ownership-transfer.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, PaymentAttempt, Contract]),
    NotificationsModule,
    FabricModule,
    PropertyOwnershipTransferModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [TypeOrmModule, PaymentsService],
})
export class PaymentsModule {}
