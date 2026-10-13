import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BookingsModule } from '../bookings/bookings.module'
import { PropertiesModule } from '../properties/properties.module'
import { ContractsModule } from '../contracts/contracts.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { LegalModule } from '../legal/legal.module'
import { RentalFlowConfigModule } from '../rental-flow-config/rental-flow-config.module'
import { PropertyOwnershipTransferModule } from '../property-ownership-transfer/property-ownership-transfer.module'
import { PlatformFeesModule } from '../platform-fees/platform-fees.module'
import { HealthModule } from '../health/health.module'
import { Contract } from '../contracts/schemas/contract.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { LedgerOutbox } from '../fabric/schemas/ledger-outbox.schema'
import { MoveInSettlement } from '../move-in-settlements/schemas/move-in-settlement.schema'
import { RentalApplicationsController } from './controllers/rental-applications.controller'
import { RentalTransactionsController } from './controllers/rental-transactions.controller'
import { RentalApplicationsService } from './services/rental-applications.service'
import { RentalTransactionEventService } from './services/rental-transaction-event.service'
import { RentalTransactionsService } from './services/rental-transactions.service'
import { RentalOpsScheduler } from './services/rental-ops.scheduler'
import { RentalApplication } from './schemas/rental-application.schema'
import { RentalTransactionEvent } from './schemas/rental-transaction-event.schema'

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RentalApplication,
      RentalTransactionEvent,
      Contract,
      DepositAgreement,
      LedgerOutbox,
      MoveInSettlement,
    ]),
    PropertiesModule,
    ContractsModule,
    NotificationsModule,
    LegalModule,
    RentalFlowConfigModule,
    PropertyOwnershipTransferModule,
    BookingsModule,
    PlatformFeesModule,
    HealthModule,
  ],
  controllers: [RentalApplicationsController, RentalTransactionsController],
  providers: [
    RentalApplicationsService,
    RentalTransactionEventService,
    RentalTransactionsService,
    RentalOpsScheduler,
  ],
  exports: [
    RentalApplicationsService,
    RentalTransactionEventService,
    RentalTransactionsService,
    RentalOpsScheduler,
  ],
})
export class RentalModule {}
