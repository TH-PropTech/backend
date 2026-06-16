import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Dispute } from './schemas/dispute.schema'

@Module({
  imports: [TypeOrmModule.forFeature([Dispute])],
  exports: [TypeOrmModule],
})
export class DisputesModule {}
