import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BiometricEvidence } from './schemas/biometric-evidence.schema'
import { EkycProxyService } from './services/ekyc-proxy.service'
import { GroqCccdOcrService } from './services/groq-cccd-ocr.service'
import { BiometricEvidenceService } from './services/biometric-evidence.service'

/**
 * Adapter eKYC (proxy sinh trắc, OCR CCCD qua Groq, bằng chứng sinh trắc).
 * Không import UsersModule (kyc import module này một chiều).
 * GroqKeyPool lấy từ AiModule (@Global).
 */
@Module({
  imports: [TypeOrmModule.forFeature([BiometricEvidence])],
  providers: [EkycProxyService, GroqCccdOcrService, BiometricEvidenceService],
  exports: [
    TypeOrmModule,
    EkycProxyService,
    GroqCccdOcrService,
    BiometricEvidenceService,
  ],
})
export class EkycModule {}
