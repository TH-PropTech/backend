import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BlockchainLog } from './schemas/blockchain-log.schema'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'
import { FabricService } from './fabric.service'
import { FabricController } from './fabric.controller'
import { LedgerOutboxService } from './ledger-outbox.service'

@Module({
  imports: [TypeOrmModule.forFeature([BlockchainLog, LedgerOutbox])],
  controllers: [FabricController],
  providers: [FabricService, LedgerOutboxService],
  exports: [FabricService, LedgerOutboxService, TypeOrmModule],
})
export class FabricModule {}
