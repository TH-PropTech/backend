import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { JwtModule } from '@nestjs/jwt'
import { User } from '../users/schemas/user.schema'
import { Notification } from '../notifications/schemas/notification.schema'
import { Otp } from './schemas/otp.schema'
import { AuthService } from './services/auth.service'
import { SignupService } from './services/signup.service'
import { PinService } from './services/pin.service'
import { EmailService } from './services/email.service'
import { TwoFactorService } from './services/two-factor.service'
import { DeviceBindingService } from './services/device-binding.service'
import { OtpSessionService } from './services/otp-session.service'
import { TotpService } from './services/totp.service'
import { SignatureService } from './services/signature.service'
import { SmartOtpService } from './services/smart-otp.service'
import { AuthController } from './controllers/auth.controller'
import { TwoFactorController } from './controllers/two-factor.controller'
import { SmartOtpController } from './controllers/smart-otp.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Notification, Otp]),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'TH_PROPTECH_SECRET_JWT_KEY',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController, TwoFactorController, SmartOtpController],
  providers: [
    AuthService,
    SignupService,
    PinService,
    EmailService,
    TwoFactorService,
    DeviceBindingService,
    OtpSessionService,
    TotpService,
    SignatureService,
    SmartOtpService,
  ],
  exports: [
    AuthService,
    SignupService,
    PinService,
    EmailService,
    JwtModule,
    TwoFactorService,
    SmartOtpService,
    TotpService,
    TypeOrmModule,
  ],
})
export class AuthModule {}
