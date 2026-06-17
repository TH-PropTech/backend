import { Controller, Get, UseGuards, Request } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { User } from './schemas/user.schema'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'

@Controller('users')
export class UsersController {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>
  ) {}

  /**
   * Lấy thông tin profile đầy đủ của người dùng hiện tại
   * Loại bỏ các trường nhạy cảm (passwordHash, pin.hash, twoFactor.secret)
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(
    @Request() req: { user: { _id: string } }
  ): Promise<Partial<User>> {
    const userId = req.user._id
    const user = await this.userRepository.findOne({
      where: { _id: new ObjectId(userId) },
    })

    if (!user) {
      throw new Error('Tài khoản không tồn tại')
    }

    // Loại bỏ các trường nhạy cảm trước khi trả về
    const { passwordHash, pin, twoFactor, ...safeUser } = user

    // Trả về pin status thay vì pin hash
    const result: Record<string, unknown> = {
      ...safeUser,
      hasPin: !!pin?.hash,
      pinSetAt: pin?.setAt || null,
      twoFactorEnabled: twoFactor?.enabled || false,
      twoFactorEnabledAt: twoFactor?.enabledAt || null,
    }

    // Suppress unused variable warnings
    void passwordHash

    return result
  }
}
