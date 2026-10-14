import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BlockchainLog } from './schemas/blockchain-log.schema'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'
import { FabricGovernanceSnapshot } from './schemas/fabric-governance-snapshot.schema'
import { LedgerReconciliationRun } from './schemas/ledger-reconciliation-run.schema'
import { LedgerReconciliationFinding } from './schemas/ledger-reconciliation-finding.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { ContractAmendment } from '../contracts/schemas/contract-amendment.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { MoveInSettlement } from '../rental/schemas/move-in-settlement.schema'
import { FabricService } from './services/fabric.service'
import { FabricController } from './controllers/fabric.controller'
import { LedgerOutboxService } from './services/ledger-outbox.service'
import { LedgerAuditQueryService } from './services/ledger-audit-query.service'
import { LedgerProjectionService } from './services/ledger-projection.service'
import { LedgerOutboxWorker } from './services/ledger-outbox.worker'
import { LedgerEvidenceQueryService } from './services/ledger-evidence-query.service'
import { FabricGovernanceService } from './services/fabric-governance.service'
import { LedgerReconciliationService } from './services/ledger-reconciliation.service'
import { LegalModule } from '../legal/legal.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BlockchainLog,
      LedgerOutbox,
      Contract,
      ContractAmendment,
      DepositAgreement,
      Payment,
      MoveInSettlement,
      FabricGovernanceSnapshot,
      LedgerReconciliationRun,
      LedgerReconciliationFinding,
    ]),
    // Nguồn governance (D2). ContractTemplate/Layout nằm trong ContractsModule (import FabricModule);
    // PlatformFeesService nằm trong PaymentsModule — cả hai được tra cứu lazy bằng ModuleRef trong
    // FabricGovernanceService để tránh vòng phụ thuộc.
    LegalModule,
  ],
  controllers: [FabricController],
  providers: [
    FabricService,
    LedgerOutboxService,
    LedgerAuditQueryService,
    LedgerProjectionService,
    LedgerOutboxWorker,
    LedgerEvidenceQueryService,
    FabricGovernanceService,
    LedgerReconciliationService,
  ],
  exports: [
    FabricService,
    LedgerOutboxService,
    LedgerAuditQueryService,
    LedgerProjectionService,
    LedgerOutboxWorker,
    LedgerEvidenceQueryService,
    FabricGovernanceService,
    LedgerReconciliationService,
    TypeOrmModule,
  ],
})
export class FabricModule {}
