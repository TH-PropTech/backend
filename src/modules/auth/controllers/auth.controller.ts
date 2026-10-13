import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common'
import { AuthService } from '../services/auth.service'
import { SignupService, SignupDto } from '../services/signup.service'
import { PinService } from '../services/pin.service'
import { IsString, IsEmail, Length, Matches } from 'class-validator'
import { User } from '../../users/schemas/user.schema'
import { TokenResponse, UserPayload } from '../interfaces/auth.interface'
import { JwtAuthGuard } from '../guards/jwt-auth.guard'
import { Throttle } from '@nestjs/throttler'
import { Public } from '../../../common/decorators/public.decorator'

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

export class Authenticate2faDto {
  @IsString()
  twoFactorTempToken!: string

  @IsString()
  code!: string
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
  @Length(6, 6, { message: 'PIN phải có độ dài đúng 6 chữ số' })
  @Matches(/^\d{6}$/, { message: 'PIN chỉ được chứa các chữ số' })
  pin!: string

  @IsString()
  sessionId!: string
}

export class VerifyPinDto {
  @IsString()
  @Length(6, 6, { message: 'PIN phải có độ dài đúng 6 chữ số' })
  @Matches(/^\d{6}$/, { message: 'PIN chỉ được chứa các chữ số' })
  pin!: string
}

export class ChangePinDto {
  @IsString()
  @Length(6, 6, { message: 'PIN phải có độ dài đúng 6 chữ số' })
  @Matches(/^\d{6}$/, { message: 'PIN chỉ được chứa các chữ số' })
  oldPin!: string

  @IsString()
  @Length(6, 6, { message: 'PIN phải có độ dài đúng 6 chữ số' })
  @Matches(/^\d{6}$/, { message: 'PIN chỉ được chứa các chữ số' })
  newPin!: string

  @IsString()
  sessionId!: string
}

export class ResetPinDto {
  @IsString()
  @Length(6, 6, { message: 'PIN phải có độ dài đúng 6 chữ số' })
  @Matches(/^\d{6}$/, { message: 'PIN chỉ được chứa các chữ số' })
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

  @Public()
  @Post('signup')
  async signup(@Body() dto: SignupDto): Promise<User> {
    return this.signupService.signup(dto)
  }

  @Public()
  @Post('signup/request-otp')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async requestSignupOtp(
    @Body() dto: RequestSignupOtpDto
  ): Promise<{ success: boolean; message: string }> {
    await this.signupService.requestSignupOtp(dto.email, dto.phone)
    return { success: true, message: 'Mã OTP đăng ký đã được gửi qua email.' }
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto
  ): Promise<TokenResponse & { user: UserPayload }> {
    return this.authService.login(dto.emailOrPhone, dto.password)
  }

  @Public()
  @Post('2fa/authenticate')
  async authenticate2fa(
    @Body() dto: Authenticate2faDto
  ): Promise<TokenResponse & { user: UserPayload }> {
    return this.authService.authenticate2fa(dto.twoFactorTempToken, dto.code)
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto
  ): Promise<TokenResponse & { user: UserPayload }> {
    return this.authService.refresh(dto.refreshToken)
  }

  @Public()
  @Post('login-otp/request')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async requestLoginOtp(@Body() dto: RequestLoginOtpDto): Promise<{
    is2faRequired: boolean
    twoFactorTempToken: string
    user: {
      _id: string
      email: string
    }
  }> {
    return this.authService.requestLoginOtp(dto.email)
  }

  @Public()
  @Post('forgot-password/request')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async requestForgotPasswordOtp(
    @Body() dto: RequestForgotPasswordOtpDto
  ): Promise<{ success: boolean; message: string }> {
    await this.authService.requestForgotPasswordOtp(dto.email)
    return {
      success: true,
      message: 'Mã OTP đặt lại mật khẩu đã được gửi qua email.',
    }
  }

  @Public()
  @Post('forgot-password/reset')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
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
  @UseGuards(JwtAuthGuard)
  async getPinStatus(
    @Request() req: { user: UserPayload }
  ): Promise<{ hasPin: boolean; pinSetAt?: Date }> {
    return this.pinService.getStatus(req.user._id!)
  }

  @Post('pin/setup')
  @UseGuards(JwtAuthGuard)
  async setupPin(
    @Body() dto: SetupPinDto,
    @Request() req: { user: UserPayload }
  ): Promise<{ success: boolean; message: string }> {
    await this.pinService.setupPin(req.user._id!, dto.pin, dto.sessionId)
    return { success: true, message: 'Thiết lập PIN thành công' }
  }

  @Post('pin/verify')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyPin(
    @Body() dto: VerifyPinDto,
    @Request() req: { user: UserPayload }
  ): Promise<{ isValid: boolean; message: string }> {
    const isValid = await this.pinService.verifyPin(req.user._id!, dto.pin)
    return {
      isValid,
      message: isValid ? 'Mã PIN chính xác' : 'Mã PIN không đúng',
    }
  }

  @Post('pin/change')
  @UseGuards(JwtAuthGuard)
  async changePin(
    @Body() dto: ChangePinDto,
    @Request() req: { user: UserPayload }
  ): Promise<{ success: boolean; message: string }> {
    await this.pinService.changePin(
      req.user._id!,
      dto.oldPin,
      dto.newPin,
      dto.sessionId
    )
    return { success: true, message: 'Thay đổi PIN thành công' }
  }

  @Post('pin/reset')
  @UseGuards(JwtAuthGuard)
  async resetPin(
    @Body() dto: ResetPinDto,
    @Request() req: { user: UserPayload }
  ): Promise<{ success: boolean; message: string }> {
    await this.pinService.resetPin(req.user._id!, dto.newPin, dto.sessionId)
    return { success: true, message: 'Đặt lại PIN thành công' }
  }
}
