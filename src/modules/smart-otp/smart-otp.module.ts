import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DeviceBinding } from './schemas/device-binding.schema'
import { TransactionOtp } from './schemas/transaction-otp.schema'
import { DeviceBindingService } from './services/device-binding.service'
import { OtpSessionService } from './services/otp-session.service'
import { TotpService } from './services/totp.service'
import { SignatureService } from './services/signature.service'
import { SmartOtpService } from './services/smart-otp.service'
import { SmartOtpController } from './smart-otp.controller'

@Module({
  imports: [TypeOrmModule.forFeature([DeviceBinding, TransactionOtp])],
  controllers: [SmartOtpController],
  providers: [
    DeviceBindingService,
    OtpSessionService,
    TotpService,
    SignatureService,
    SmartOtpService,
  ],
  exports: [SmartOtpService, TotpService, TypeOrmModule],
})
export class SmartOtpModule {}
