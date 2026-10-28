import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BookingsModule } from '../bookings/bookings.module'
import { PropertiesModule } from '../properties/properties.module'
import { ContractsModule } from '../contracts/contracts.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { LegalModule } from '../legal/legal.module'
import { HealthModule } from '../health/health.module'
import { FabricModule } from '../fabric/fabric.module'
import { ActivityLogModule } from '../activity-log/activity-log.module'
import { Contract } from '../contracts/schemas/contract.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { LedgerOutbox } from '../fabric/schemas/ledger-outbox.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { MoveInSettlement } from './schemas/move-in-settlement.schema'
import { MoveOutHandover } from './schemas/move-out-handover.schema'
import { DepositSettlementStatement } from './schemas/deposit-settlement-statement.schema'
import { RentalFlowConfig } from './schemas/rental-flow-config.schema'
import { RentalApplicationsController } from './controllers/rental-applications.controller'
import { RentalTransactionsController } from './controllers/rental-transactions.controller'
import { RentalExecutionPoliciesController } from './controllers/rental-execution-policies.controller'
import { MoveInSettlementsController } from './controllers/move-in-settlements.controller'
import { MoveOutHandoversController } from './controllers/move-out-handovers.controller'
import { DepositSettlementStatementsController } from './controllers/deposit-settlement-statements.controller'
import { RentalApplicationsService } from './services/rental-applications.service'
import { RentalTransactionEventService } from './services/rental-transaction-event.service'
import { RentalTransactionsService } from './services/rental-transactions.service'
import { RentalOpsScheduler } from './services/rental-ops.scheduler'
import { RentalFlowProfilesService } from './services/rental-flow-profiles.service'
import { RentalFlowAssignmentsService } from './services/rental-flow-assignments.service'
import { RentalFlowConfigResolver } from './services/rental-flow-config-resolver.service'
import { ContractImpactAnalyzer } from './services/contract-impact-analyzer.service'
import { RentalExecutionPoliciesService } from './services/rental-execution-policies.service'
import { MoveInSettlementsService } from './services/move-in-settlements.service'
import { MoveOutSupportService } from './services/move-out-support.service'
import { MoveOutHandoversService } from './services/move-out-handovers.service'
import { DepositSettlementStatementsService } from './services/deposit-settlement-statements.service'
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
      MoveOutHandover,
      DepositSettlementStatement,
      Payment,
      RentalFlowConfig,
    ]),
    PropertiesModule,
    ContractsModule,
    NotificationsModule,
    LegalModule,
    BookingsModule,
    HealthModule,
    FabricModule,
    ActivityLogModule,
  ],
  controllers: [
    RentalApplicationsController,
    RentalTransactionsController,
    RentalExecutionPoliciesController,
    MoveInSettlementsController,
    MoveOutHandoversController,
    DepositSettlementStatementsController,
  ],
  providers: [
    RentalApplicationsService,
    RentalTransactionEventService,
    RentalTransactionsService,
    RentalOpsScheduler,
    RentalFlowProfilesService,
    RentalFlowAssignmentsService,
    RentalFlowConfigResolver,
    ContractImpactAnalyzer,
    RentalExecutionPoliciesService,
    MoveInSettlementsService,
    MoveOutSupportService,
    MoveOutHandoversService,
    DepositSettlementStatementsService,
  ],
  exports: [
    RentalApplicationsService,
    RentalTransactionEventService,
    RentalTransactionsService,
    RentalOpsScheduler,
    RentalFlowProfilesService,
    RentalFlowAssignmentsService,
    RentalFlowConfigResolver,
    ContractImpactAnalyzer,
    RentalExecutionPoliciesService,
    MoveInSettlementsService,
    MoveOutSupportService,
    MoveOutHandoversService,
    DepositSettlementStatementsService,
  ],
})
export class RentalModule {}
