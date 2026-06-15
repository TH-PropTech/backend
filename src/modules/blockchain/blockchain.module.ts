import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BlockchainLog } from './schemas/blockchain-log.schema'

@Module({
  imports: [TypeOrmModule.forFeature([BlockchainLog])],
  exports: [TypeOrmModule],
})
export class BlockchainModule {}
