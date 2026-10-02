import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { RentalTransactionEvent } from './schemas/rental-transaction-event.schema'
import { RentalTransactionEventService } from './rental-transaction-event.service'
import { RentalTransactionsService } from './rental-transactions.service'
import { RentalTransactionsController } from './rental-transactions.controller'
import { RentalApplication } from '../rental-applications/schemas/rental-application.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { LedgerOutbox } from '../fabric/schemas/ledger-outbox.schema'
import { MoveInSettlement } from '../move-in-settlements/schemas/move-in-settlement.schema'

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RentalTransactionEvent,
      RentalApplication,
      Contract,
      DepositAgreement,
      LedgerOutbox,
      MoveInSettlement,
    ]),
  ],
  controllers: [RentalTransactionsController],
  providers: [RentalTransactionEventService, RentalTransactionsService],
  exports: [RentalTransactionEventService, RentalTransactionsService],
})
export class RentalTransactionsModule {}
