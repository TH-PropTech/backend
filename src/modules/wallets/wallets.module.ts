import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { NotificationsModule } from '../notifications/notifications.module'
import { Payment } from '../payments/schemas/payment.schema'
import { User } from '../users/schemas/user.schema'
import { PayoutsController } from './controllers/payouts.controller'
import { WalletController } from './controllers/wallet.controller'
import { Payout } from './schemas/payout.schema'
import { Wallet } from './schemas/wallet.schema'
import { MocbankEscrowClient } from './services/mocbank-escrow.client'
import { MocbankPayoutClient } from './services/mocbank-payout.client'
import { PayoutsService } from './services/payouts.service'
import { WalletsService } from './services/wallets.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, User, Payment, Payout]),
    NotificationsModule,
  ],
  controllers: [PayoutsController, WalletController],
  providers: [
    WalletsService,
    PayoutsService,
    MocbankPayoutClient,
    MocbankEscrowClient,
  ],
  exports: [WalletsService, PayoutsService, MocbankEscrowClient],
})
export class WalletsModule {}
