import {
  Controller,
  Post,
  Body,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common'
import { TwoFactorService } from './two-factor.service'
import { Enable2faDto, Verify2faDto } from './dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { UserPayload } from '../auth/interfaces/auth.interface'

@Controller('two-factor')
@UseGuards(JwtAuthGuard)
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  private getUserId(user: UserPayload): string {
    if (!user?._id) {
      throw new UnauthorizedException(
        'Không tìm thấy thông tin phiên đăng nhập'
      )
    }
    return user._id
  }

  @Post('generate')
  async generate(
    @CurrentUser() user: UserPayload
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const userId = this.getUserId(user)
    return this.twoFactorService.generate2faSecret(userId)
  }

  @Post('enable')
  async enable(
    @CurrentUser() user: UserPayload,
    @Body() dto: Enable2faDto
  ): Promise<{ success: boolean; message: string; backupCodes?: string[] }> {
    const userId = this.getUserId(user)
    const { success, backupCodes } = await this.twoFactorService.enable2fa(
      userId,
      dto.token
    )
    return { success, message: 'Đã kích hoạt 2FA thành công', backupCodes }
  }

  @Post('verify')
  async verify(
    @CurrentUser() user: UserPayload,
    @Body() dto: Verify2faDto
  ): Promise<{ isValid: boolean; message: string }> {
    const userId = this.getUserId(user)
    const isValid = await this.twoFactorService.verify2fa(userId, dto.token)
    return {
      isValid,
      message: isValid ? 'Mã 2FA hợp lệ' : 'Mã 2FA không chính xác',
    }
  }

  @Post('disable')
  async disable(
    @CurrentUser() user: UserPayload
  ): Promise<{ success: boolean; message: string }> {
    const userId = this.getUserId(user)
    await this.twoFactorService.disable2fa(userId)
    return { success: true, message: 'Đã tắt 2FA thành công' }
  }
}
