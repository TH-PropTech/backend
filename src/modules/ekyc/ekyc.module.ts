import { Module } from '@nestjs/common'
import { EkycProxyService } from './services/ekyc-proxy.service'
import { GroqCccdOcrService } from './services/groq-cccd-ocr.service'

/**
 * Adapter eKYC (proxy eKYC, OCR CCCD qua Groq).
 * Không import UsersModule (kyc import module này một chiều).
 * GroqKeyPool lấy từ AiModule (@Global).
 */
@Module({
  providers: [EkycProxyService, GroqCccdOcrService],
  exports: [EkycProxyService, GroqCccdOcrService],
})
export class EkycModule {}
