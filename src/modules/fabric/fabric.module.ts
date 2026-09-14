import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BlockchainLog } from './schemas/blockchain-log.schema'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'
import { FabricService } from './fabric.service'
import { FabricController } from './fabric.controller'
import { LedgerOutboxService } from './ledger-outbox.service'
import { LedgerAuditQueryService } from './ledger-audit-query.service'

@Module({
  imports: [TypeOrmModule.forFeature([BlockchainLog, LedgerOutbox])],
  controllers: [FabricController],
  providers: [FabricService, LedgerOutboxService, LedgerAuditQueryService],
  exports: [
    FabricService,
    LedgerOutboxService,
    LedgerAuditQueryService,
    TypeOrmModule,
  ],
})
export class FabricModule {}
