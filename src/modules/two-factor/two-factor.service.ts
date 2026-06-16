import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { User } from '../users/schemas/user.schema'
import { TotpService } from '../smart-otp/services/totp.service'

@Injectable()
export class TwoFactorService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly totpService: TotpService
  ) {}

  /**
   * Tạo khóa bí mật 2FA và link mã QR
   */
  async generate2faSecret(
    userId: string
  ): Promise<{ secret: string; otpauthUrl: string }> {
    let parsedId: ObjectId
    try {
      parsedId = new ObjectId(userId)
    } catch {
      throw new BadRequestException('Mã người dùng không hợp lệ')
    }

    const user = await this.userRepository.findOne({
      where: { _id: parsedId },
    })

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng')
    }

    const secret = this.totpService.generateSecret(16)
    const label = encodeURIComponent(`TH-PropTech:${user.email}`)
    const issuer = encodeURIComponent('TH-PropTech')
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`

    // Lưu tạm secret vào DB (chưa kích hoạt 2FA)
    user.twoFactor = {
      enabled: false,
      secret,
    }

    await this.userRepository.save(user)

    return { secret, otpauthUrl }
  }

  /**
   * Xác thực token lần đầu để kích hoạt 2FA
   */
  async enable2fa(userId: string, token: string): Promise<boolean> {
    let parsedId: ObjectId
    try {
      parsedId = new ObjectId(userId)
    } catch {
      throw new BadRequestException('Mã người dùng không hợp lệ')
    }

    const user = await this.userRepository.findOne({
      where: { _id: parsedId },
    })

    if (!user || !user.twoFactor || !user.twoFactor.secret) {
      throw new BadRequestException('Chưa tạo khóa bí mật 2FA')
    }

    const isValid = this.totpService.verifyToken(
      user.twoFactor.secret,
      token,
      1
    )
    if (!isValid) {
      throw new BadRequestException('Mã xác thực không chính xác')
    }

    user.twoFactor.enabled = true
    user.twoFactor.enabledAt = new Date()

    await this.userRepository.save(user)
    return true
  }

  /**
   * Xác thực mã 2FA TOTP trong các luồng đăng nhập/giao dịch
   */
  async verify2fa(userId: string, token: string): Promise<boolean> {
    let parsedId: ObjectId
    try {
      parsedId = new ObjectId(userId)
    } catch {
      throw new BadRequestException('Mã người dùng không hợp lệ')
    }

    const user = await this.userRepository.findOne({
      where: { _id: parsedId },
    })

    if (
      !user ||
      !user.twoFactor ||
      !user.twoFactor.enabled ||
      !user.twoFactor.secret
    ) {
      return false
    }

    return this.totpService.verifyToken(user.twoFactor.secret, token, 1)
  }

  /**
   * Tắt 2FA
   */
  async disable2fa(userId: string): Promise<void> {
    let parsedId: ObjectId
    try {
      parsedId = new ObjectId(userId)
    } catch {
      throw new BadRequestException('Mã người dùng không hợp lệ')
    }

    const user = await this.userRepository.findOne({
      where: { _id: parsedId },
    })

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng')
    }

    user.twoFactor = {
      enabled: false,
    }

    await this.userRepository.save(user)
  }
}
