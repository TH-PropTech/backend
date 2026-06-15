import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { User } from '../../modules/users/schemas/user.schema'
import { SKIP_KYC_CHECK_KEY } from '../decorators/skip-kyc-check.decorator'

/**
 * KycVerifiedGuard — Chặn người dùng chưa được duyệt hồ sơ KYC (status !== 'verified').
 * Đảm bảo an toàn cho các giao dịch tài chính (Đầu tư, Vay, Ví).
 * Sử dụng @SkipKycCheck() trên method để bỏ qua guard (ví dụ: notification).
 */
@Injectable()
export class KycVerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(User) private readonly userRepository: Repository<User>
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipKyc = this.reflector.getAllAndOverride<boolean>(
      SKIP_KYC_CHECK_KEY,
      [context.getHandler(), context.getClass()]
    )
    if (skipKyc) return true

    const request = context.switchToHttp().getRequest<{
      user?: { _id?: string | ObjectId; id?: string | ObjectId }
    }>()
    const user = request.user

    if (!user || (!user._id && !user.id)) {
      throw new ForbiddenException(
        'Bạn cần đăng nhập để thực hiện chức năng này.'
      )
    }

    const userIdStr = user._id || user.id
    let userId: ObjectId
    try {
      userId =
        typeof userIdStr === 'string'
          ? new ObjectId(userIdStr)
          : (userIdStr as ObjectId)
    } catch {
      throw new ForbiddenException('ID người dùng không hợp lệ.')
    }

    const foundUser = await this.userRepository.findOne({
      where: { _id: userId },
      select: ['kycStatus'],
    })

    if (!foundUser) {
      throw new ForbiddenException('Không tìm thấy thông tin người dùng.')
    }

    if (foundUser.kycStatus !== 'verified') {
      throw new ForbiddenException(
        'Tài khoản của bạn chưa được duyệt định danh (eKYC). Vui lòng hoàn tất và chờ phê duyệt để mở khóa chức năng này.'
      )
    }

    return true
  }
}
