import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BlockchainLog } from './schemas/blockchain-log.schema'
import { FabricService } from './fabric.service'
import { FabricController } from './fabric.controller'

@Module({
  imports: [TypeOrmModule.forFeature([BlockchainLog])],
  controllers: [FabricController],
  providers: [FabricService],
  exports: [FabricService, TypeOrmModule],
})
export class FabricModule {}
