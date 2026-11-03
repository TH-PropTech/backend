import { Module } from '@nestjs/common'
import { EkycClient } from './services/ekyc-client.service'

/**
 * Adapter eKYC (OCR CCCD + xác thực khuôn mặt qua dịch vụ Python).
 * Không import UsersModule (kyc import module này một chiều).
 */
@Module({
  providers: [EkycClient],
  exports: [EkycClient],
})
export class EkycModule {}
