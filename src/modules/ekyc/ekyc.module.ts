import { Module } from '@nestjs/common'
import { GroqCccdOcrService } from './services/groq-cccd-ocr.service'

/**
 * Adapter eKYC (OCR CCCD qua Groq).
 * Không import UsersModule (kyc import module này một chiều).
 * GroqKeyPool lấy từ AiModule (@Global).
 */
@Module({
  providers: [GroqCccdOcrService],
  exports: [GroqCccdOcrService],
})
export class EkycModule {}
