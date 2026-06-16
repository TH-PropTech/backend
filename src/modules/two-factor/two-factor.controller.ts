import { Controller, Post, Body } from '@nestjs/common'
import { TwoFactorService } from './two-factor.service'
import { Generate2faDto, Enable2faDto, Verify2faDto } from './dto'

@Controller('two-factor')
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  @Post('generate')
  async generate(
    @Body() dto: Generate2faDto
  ): Promise<{ secret: string; otpauthUrl: string }> {
    return this.twoFactorService.generate2faSecret(dto.userId)
  }

  @Post('enable')
  async enable(
    @Body() dto: Enable2faDto
  ): Promise<{ success: boolean; message: string }> {
    const success = await this.twoFactorService.enable2fa(dto.userId, dto.token)
    return { success, message: 'Đã kích hoạt 2FA thành công' }
  }

  @Post('verify')
  async verify(
    @Body() dto: Verify2faDto
  ): Promise<{ isValid: boolean; message: string }> {
    const isValid = await this.twoFactorService.verify2fa(dto.userId, dto.token)
    return {
      isValid,
      message: isValid ? 'Mã 2FA hợp lệ' : 'Mã 2FA không chính xác',
    }
  }

  @Post('disable')
  async disable(
    @Body() dto: Generate2faDto
  ): Promise<{ success: boolean; message: string }> {
    await this.twoFactorService.disable2fa(dto.userId)
    return { success: true, message: 'Đã tắt 2FA thành công' }
  }
}
