import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { KycRecord } from './schemas/kyc-record.schema'
import { BiometricEvidence } from './schemas/biometric-evidence.schema'
import { User } from '../users/schemas/user.schema'
import { KycService } from './kyc.service'
import { KycController } from './kyc.controller'
import { EkycProxyService } from './ekyc-proxy.service'
import { BiometricGrantService } from './biometric-grant.service'
import { BiometricEvidenceService } from './biometric-evidence.service'
import { KycMediaService } from './kyc-media.service'

@Module({
  imports: [TypeOrmModule.forFeature([KycRecord, User, BiometricEvidence])],
  providers: [
    KycService,
    EkycProxyService,
    BiometricGrantService,
    BiometricEvidenceService,
    KycMediaService,
  ],
  controllers: [KycController],
  exports: [
    TypeOrmModule,
    KycService,
    EkycProxyService,
    BiometricGrantService,
    BiometricEvidenceService,
    KycMediaService,
  ],
})
export class KycModule {}
