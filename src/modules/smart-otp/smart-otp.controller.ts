import { Controller, Post, Body } from '@nestjs/common'
import { IsString, IsEnum } from 'class-validator'
import { SmartOtpService } from './services/smart-otp.service'
import { OtpActionType } from './enums/otp-action-type.enum'
import { DeviceBinding } from './schemas/device-binding.schema'

export class BindDeviceDto {
  @IsString()
  userId!: string

  @IsString()
  deviceId!: string

  @IsString()
  deviceName!: string

  @IsString()
  publicKey!: string
}

export class InitiateOtpDto {
  @IsString()
  userId!: string

  @IsString()
  deviceId!: string

  @IsEnum(OtpActionType)
  action!: OtpActionType
}

export class VerifyOtpDto {
  @IsString()
  userId!: string

  @IsString()
  sessionId!: string

  @IsString()
  otpCode!: string

  @IsString()
  signature!: string
}

@Controller('smart-otp')
export class SmartOtpController {
  constructor(private readonly smartOtpService: SmartOtpService) {}

  @Post('bind')
  async bindDevice(@Body() dto: BindDeviceDto): Promise<DeviceBinding> {
    return this.smartOtpService.registerDevice(
      dto.userId,
      dto.deviceId,
      dto.deviceName,
      dto.publicKey
    )
  }

  @Post('initiate')
  async initiateOtp(
    @Body() dto: InitiateOtpDto
  ): Promise<{ sessionId: string; challenge: string; expiredAt: Date }> {
    return this.smartOtpService.initiateOtpSession(
      dto.userId,
      dto.deviceId,
      dto.action
    )
  }

  @Post('verify')
  async verifyOtp(
    @Body() dto: VerifyOtpDto
  ): Promise<{ success: boolean; message: string }> {
    return this.smartOtpService.verifyOtpSignature(
      dto.userId,
      dto.sessionId,
      dto.otpCode,
      dto.signature
    )
  }
}
