import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { JwtModule } from '@nestjs/jwt'
import { User } from '../users/schemas/user.schema'
import { Notification } from '../notifications/schemas/notification.schema'
import { EmailOtp } from './schemas/email-otp.schema'
import { SmartOtpModule } from '../smart-otp/smart-otp.module'
import { AuthService } from './services/auth.service'
import { SignupService } from './services/signup.service'
import { PinService } from './services/pin.service'
import { EmailService } from './services/email.service'
import { AuthController } from './auth.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Notification, EmailOtp]),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'TH_PROPTECH_SECRET_JWT_KEY',
      signOptions: { expiresIn: '1d' },
    }),
    SmartOtpModule, // Import SmartOtpModule để phục vụ PinService
  ],
  controllers: [AuthController],
  providers: [AuthService, SignupService, PinService, EmailService],
  exports: [AuthService, SignupService, PinService, EmailService, JwtModule],
})
export class AuthModule {}
