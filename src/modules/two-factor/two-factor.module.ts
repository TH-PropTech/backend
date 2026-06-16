import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { User } from '../users/schemas/user.schema'
import { SmartOtpModule } from '../smart-otp/smart-otp.module'
import { TwoFactorService } from './two-factor.service'
import { TwoFactorController } from './two-factor.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    SmartOtpModule, // Import SmartOtpModule để dùng chung TotpService
  ],
  controllers: [TwoFactorController],
  providers: [TwoFactorService],
  exports: [TwoFactorService],
})
export class TwoFactorModule {}
