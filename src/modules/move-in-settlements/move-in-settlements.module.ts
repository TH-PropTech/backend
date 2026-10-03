import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { NotificationsModule } from '../notifications/notifications.module'
import { FabricModule } from '../fabric/fabric.module'
import { Contract } from '../contracts/schemas/contract.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { MoveInSettlement } from './schemas/move-in-settlement.schema'
import { MoveInSettlementsController } from './move-in-settlements.controller'
import { MoveInSettlementsService } from './move-in-settlements.service'
import { MoveInSettlementScheduler } from './move-in-settlement.scheduler'

@Module({
  imports: [
    TypeOrmModule.forFeature([MoveInSettlement, Contract, Payment]),
    NotificationsModule,
    FabricModule,
  ],
  controllers: [MoveInSettlementsController],
  providers: [MoveInSettlementsService, MoveInSettlementScheduler],
  exports: [MoveInSettlementsService],
})
export class MoveInSettlementsModule {}
