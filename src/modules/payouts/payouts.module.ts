import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { MockWallet } from '../mock-bank/schemas/mock-wallet.schema'
import { NotificationsModule } from '../notifications/notifications.module'
import { WalletsModule } from '../wallets/wallets.module'
import { PayoutsController } from './payouts.controller'
import { PayoutsService } from './payouts.service'
import { Payout } from './schemas/payout.schema'
import { WalletController } from './wallet.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([Payout, MockWallet]),
    NotificationsModule,
    WalletsModule,
  ],
  controllers: [PayoutsController, WalletController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
