import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { MongoRepository } from 'typeorm'
import { Expo } from 'expo-server-sdk'
import { PushToken } from '../schemas/push-token.schema'
import { RegisterPushTokenDto } from '../dto/register-push-token.dto'

@Injectable()
export class PushTokensService {
  constructor(
    @InjectRepository(PushToken)
    private readonly pushTokenRepository: MongoRepository<PushToken>
  ) {}

  /**
   * Gắn token thiết bị với user. Token chỉ thuộc một user tại một thời điểm:
   * khi máy đổi tài khoản, bản ghi của user cũ bị xóa để họ không nhận nhầm.
   * Gọi lại cùng cặp (user, token) là idempotent.
   */
  async register(userId: string, dto: RegisterPushTokenDto): Promise<void> {
    if (!Expo.isExpoPushToken(dto.token)) {
      throw new BadRequestException('Token thông báo đẩy không hợp lệ')
    }

    await this.pushTokenRepository.deleteMany({
      token: dto.token,
      userId: { $ne: userId },
    })

    const platform = dto.platform ?? null
    const existing = await this.pushTokenRepository.findOne({
      where: { userId, token: dto.token },
    })
    if (existing) {
      if (platform && existing.platform !== platform) {
        await this.pushTokenRepository.save({ ...existing, platform })
      }
      return
    }

    await this.pushTokenRepository.save(
      this.pushTokenRepository.create({ userId, token: dto.token, platform })
    )
  }

  /** Hủy token của chính user (đăng xuất); không có thì bỏ qua. */
  async unregister(userId: string, token: string): Promise<void> {
    await this.pushTokenRepository.deleteMany({ userId, token })
  }

  async findTokensByUser(userId: string): Promise<string[]> {
    const rows = await this.pushTokenRepository.find({ where: { userId } })
    return rows.map(row => row.token)
  }

  /** Xóa token đã chết (Expo báo DeviceNotRegistered) khỏi mọi user. */
  async removeTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return
    await this.pushTokenRepository.deleteMany({ token: { $in: tokens } })
  }
}
