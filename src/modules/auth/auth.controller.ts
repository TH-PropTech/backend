import { Controller, Post, Body } from '@nestjs/common'
import { AuthService } from './services/auth.service'
import { SignupService, SignupDto } from './services/signup.service'
import { PinService } from './services/pin.service'
import { IsString, IsEmail } from 'class-validator'
import { User } from '../users/schemas/user.schema'
import { TokenResponse, UserPayload } from './interfaces/auth.interface'

export class RefreshTokenDto {
  @IsString()
  refreshToken!: string
}

export class LoginDto {
  @IsString()
  emailOrPhone!: string

  @IsString()
  password!: string
}

export class RequestLoginOtpDto {
  @IsEmail()
  email!: string
}

export class RequestSignupOtpDto {
  @IsEmail()
  email!: string

  @IsString()
  phone!: string
}

export class VerifyLoginOtpDto {
  @IsEmail()
  email!: string

  @IsString()
  otp!: string
}

export class RequestForgotPasswordOtpDto {
  @IsEmail()
  email!: string
}

export class ResetPasswordDto {
  @IsEmail()
  email!: string

  @IsString()
  otp!: string

  @IsString()
  newPassword!: string
}

export class SetupPinDto {
  @IsString()
  userId!: string

  @IsString()
  pin!: string

  @IsString()
  sessionId!: string
}

export class VerifyPinDto {
  @IsString()
  userId!: string

  @IsString()
  pin!: string
}

export class ChangePinDto {
  @IsString()
  userId!: string

  @IsString()
  oldPin!: string

  @IsString()
  newPin!: string

  @IsString()
  sessionId!: string
}

export class ResetPinDto {
  @IsString()
  userId!: string

  @IsString()
  newPin!: string

  @IsString()
  sessionId!: string
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly signupService: SignupService,
    private readonly pinService: PinService
  ) {}

  @Post('signup')
  async signup(@Body() dto: SignupDto): Promise<User> {
    return this.signupService.signup(dto)
  }

  @Post('signup/request-otp')
  async requestSignupOtp(
    @Body() dto: RequestSignupOtpDto
  ): Promise<{ success: boolean; message: string }> {
    await this.signupService.requestSignupOtp(dto.email, dto.phone)
    return { success: true, message: 'Mã OTP đăng ký đã được gửi qua email.' }
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto
  ): Promise<TokenResponse & { user: UserPayload }> {
    return this.authService.login(dto.emailOrPhone, dto.password)
  }

  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto
  ): Promise<TokenResponse & { user: UserPayload }> {
    return this.authService.refresh(dto.refreshToken)
  }

  @Post('login-otp/request')
  async requestLoginOtp(
    @Body() dto: RequestLoginOtpDto
  ): Promise<{ success: boolean; message: string }> {
    await this.authService.requestLoginOtp(dto.email)
    return { success: true, message: 'Mã OTP đăng nhập đã được gửi qua email.' }
  }

  @Post('login-otp/verify')
  async verifyLoginOtp(
    @Body() dto: VerifyLoginOtpDto
  ): Promise<TokenResponse & { user: UserPayload }> {
    return this.authService.verifyLoginOtp(dto.email, dto.otp)
  }

  @Post('forgot-password/request')
  async requestForgotPasswordOtp(
    @Body() dto: RequestForgotPasswordOtpDto
  ): Promise<{ success: boolean; message: string }> {
    await this.authService.requestForgotPasswordOtp(dto.email)
    return {
      success: true,
      message: 'Mã OTP đặt lại mật khẩu đã được gửi qua email.',
    }
  }

  @Post('forgot-password/reset')
  async resetPasswordWithOtp(
    @Body() dto: ResetPasswordDto
  ): Promise<{ success: boolean; message: string }> {
    await this.authService.resetPasswordWithOtp(
      dto.email,
      dto.otp,
      dto.newPassword
    )
    return { success: true, message: 'Đặt lại mật khẩu thành công.' }
  }

  @Post('pin/status')
  async getPinStatus(
    @Body('userId') userId: string
  ): Promise<{ hasPin: boolean; pinSetAt?: Date }> {
    return this.pinService.getStatus(userId)
  }

  @Post('pin/setup')
  async setupPin(
    @Body() dto: SetupPinDto
  ): Promise<{ success: boolean; message: string }> {
    await this.pinService.setupPin(dto.userId, dto.pin, dto.sessionId)
    return { success: true, message: 'Thiết lập PIN thành công' }
  }

  @Post('pin/verify')
  async verifyPin(
    @Body() dto: VerifyPinDto
  ): Promise<{ isValid: boolean; message: string }> {
    const isValid = await this.pinService.verifyPin(dto.userId, dto.pin)
    return {
      isValid,
      message: isValid ? 'Mã PIN chính xác' : 'Mã PIN không đúng',
    }
  }

  @Post('pin/change')
  async changePin(
    @Body() dto: ChangePinDto
  ): Promise<{ success: boolean; message: string }> {
    await this.pinService.changePin(
      dto.userId,
      dto.oldPin,
      dto.newPin,
      dto.sessionId
    )
    return { success: true, message: 'Thay đổi PIN thành công' }
  }

  @Post('pin/reset')
  async resetPin(
    @Body() dto: ResetPinDto
  ): Promise<{ success: boolean; message: string }> {
    await this.pinService.resetPin(dto.userId, dto.newPin, dto.sessionId)
    return { success: true, message: 'Đặt lại PIN thành công' }
  }
}
