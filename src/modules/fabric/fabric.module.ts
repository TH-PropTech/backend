import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BlockchainLog } from './schemas/blockchain-log.schema'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { ContractAmendment } from '../contracts/schemas/contract-amendment.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { FabricService } from './fabric.service'
import { FabricController } from './fabric.controller'
import { LedgerOutboxService } from './ledger-outbox.service'
import { LedgerAuditQueryService } from './ledger-audit-query.service'
import { LedgerProjectionService } from './ledger-projection.service'
import { LedgerOutboxWorker } from './ledger-outbox.worker'
import { LedgerEvidenceQueryService } from './ledger-evidence-query.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BlockchainLog,
      LedgerOutbox,
      Contract,
      ContractAmendment,
      DepositAgreement,
      Payment,
    ]),
  ],
  controllers: [FabricController],
  providers: [
    FabricService,
    LedgerOutboxService,
    LedgerAuditQueryService,
    LedgerProjectionService,
    LedgerOutboxWorker,
    LedgerEvidenceQueryService,
  ],
  exports: [
    FabricService,
    LedgerOutboxService,
    LedgerAuditQueryService,
    LedgerProjectionService,
    LedgerOutboxWorker,
    LedgerEvidenceQueryService,
    TypeOrmModule,
  ],
})
export class FabricModule {}
