import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { KycRecord } from './schemas/kyc-record.schema'
import { User } from '../users/schemas/user.schema'
import { KycService } from './kyc.service'
import { KycController } from './kyc.controller'
import { EkycProxyService } from './ekyc-proxy.service'
import { BiometricGrantService } from './biometric-grant.service'
import { KycMediaService } from './kyc-media.service'

@Module({
  imports: [TypeOrmModule.forFeature([KycRecord, User])],
  providers: [
    KycService,
    EkycProxyService,
    BiometricGrantService,
    KycMediaService,
  ],
  controllers: [KycController],
  exports: [TypeOrmModule, KycService, EkycProxyService, KycMediaService],
})
export class KycModule {}
