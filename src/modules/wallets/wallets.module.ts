import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { MockWallet } from '../mock-bank/schemas/mock-wallet.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { User } from '../users/schemas/user.schema'
import { WalletTransaction } from './schemas/wallet-transaction.schema'
import { WalletsService } from './wallets.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([MockWallet, WalletTransaction, User, Payment]),
  ],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
