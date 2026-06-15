import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { KycRecord } from './schemas/kyc-record.schema'

@Module({
  imports: [TypeOrmModule.forFeature([KycRecord])],
  exports: [TypeOrmModule],
})
export class KycModule {}
