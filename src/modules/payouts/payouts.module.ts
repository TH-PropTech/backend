import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { MockWallet } from '../mock-bank/schemas/mock-wallet.schema'
import { NotificationsModule } from '../notifications/notifications.module'
import { PayoutsController } from './payouts.controller'
import { PayoutsService } from './payouts.service'
import { Payout } from './schemas/payout.schema'

@Module({
  imports: [
    TypeOrmModule.forFeature([Payout, MockWallet]),
    NotificationsModule,
  ],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
