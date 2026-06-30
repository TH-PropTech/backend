import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { KycRecord } from './schemas/kyc-record.schema'
import { User } from '../users/schemas/user.schema'
import { KycService } from './kyc.service'
import { KycController } from './kyc.controller'
import { EkycProxyService } from './ekyc-proxy.service'

@Module({
  imports: [TypeOrmModule.forFeature([KycRecord, User])],
  providers: [KycService, EkycProxyService],
  controllers: [KycController],
  exports: [TypeOrmModule, KycService, EkycProxyService],
})
export class KycModule {}
