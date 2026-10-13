import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { IsString, IsEnum, IsOptional } from 'class-validator'
import { JwtAuthGuard } from '../guards/jwt-auth.guard'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { SmartOtpService } from '../services/smart-otp.service'
import { OtpActionType } from '../enums/otp-action-type.enum'
import { DeviceBinding } from '../schemas/device-binding.schema'

export class BindDeviceDto {
  @IsString()
  @IsOptional()
  userId?: string

  @IsString()
  deviceId!: string

  @IsString()
  deviceName!: string

  @IsString()
  publicKey!: string
}

export class InitiateOtpDto {
  @IsString()
  @IsOptional()
  userId?: string

  @IsString()
  deviceId!: string

  @IsEnum(OtpActionType)
  action!: OtpActionType
}

export class VerifyOtpDto {
  @IsString()
  @IsOptional()
  userId?: string

  @IsString()
  sessionId!: string

  @IsString()
  otpCode!: string

  @IsString()
  signature!: string
}

@ApiTags('smart-otp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('smart-otp')
export class SmartOtpController {
  constructor(private readonly smartOtpService: SmartOtpService) {}

  @Post('bind')
  async bindDevice(
    @Body() dto: BindDeviceDto,
    @CurrentUser('id') currentUserId?: string
  ): Promise<DeviceBinding> {
    const userId = currentUserId || dto.userId || ''
    return this.smartOtpService.registerDevice(
      userId,
      dto.deviceId,
      dto.deviceName,
      dto.publicKey
    )
  }

  @Post('initiate')
  async initiateOtp(
    @Body() dto: InitiateOtpDto,
    @CurrentUser('id') currentUserId?: string
  ): Promise<{
    sessionId: string
    challenge: string
    expiredAt: Date
    otpCode?: string
  }> {
    const userId = currentUserId || dto.userId || ''
    return this.smartOtpService.initiateOtpSession(
      userId,
      dto.deviceId,
      dto.action
    )
  }

  @Post('verify')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @CurrentUser('id') currentUserId?: string
  ): Promise<{ success: boolean; message: string }> {
    const userId = currentUserId || dto.userId || ''
    return this.smartOtpService.verifyOtpSignature(
      userId,
      dto.sessionId,
      dto.otpCode,
      dto.signature
    )
  }
}
