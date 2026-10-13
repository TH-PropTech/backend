import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import * as bcrypt from 'bcryptjs'
import { User } from '../../users/schemas/user.schema'
import { TotpService } from './totp.service'

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

    await this.userRepository.update(parsedId, { twoFactor: user.twoFactor })

    return { secret, otpauthUrl }
  }

  /**
   * Xác thực token lần đầu để kích hoạt 2FA
   */
  async enable2fa(
    userId: string,
    token: string
  ): Promise<{ success: boolean; backupCodes: string[] }> {
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

    // Sinh mã dự phòng
    const rawBackupCodes = this.generateBackupCodes(10)
    const hashedBackupCodes = await Promise.all(
      rawBackupCodes.map(code => bcrypt.hash(code, 10))
    )

    user.twoFactor = {
      ...user.twoFactor,
      enabled: true,
      enabledAt: new Date(),
      backupCodes: hashedBackupCodes,
    }

    await this.userRepository.update(parsedId, { twoFactor: user.twoFactor })
    return { success: true, backupCodes: rawBackupCodes }
  }

  private generateBackupCodes(count = 10): string[] {
    const codes: string[] = []
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    for (let i = 0; i < count; i++) {
      let code = ''
      for (let j = 0; j < 8; j++) {
        if (j === 4) code += '-'
        code += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      codes.push(code)
    }
    return codes
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

    const isOtpValid = this.totpService.verifyToken(
      user.twoFactor.secret,
      token,
      1
    )
    if (isOtpValid) {
      return true
    }

    // Nếu OTP sai, kiểm tra xem có phải mã dự phòng (backup codes) không
    if (user.twoFactor.backupCodes && user.twoFactor.backupCodes.length > 0) {
      for (let i = 0; i < user.twoFactor.backupCodes.length; i++) {
        const hashedCode = user.twoFactor.backupCodes[i]
        if (!hashedCode) continue
        const isMatch = await bcrypt.compare(token, hashedCode)
        if (isMatch) {
          user.twoFactor.backupCodes.splice(i, 1)
          user.twoFactor = {
            ...user.twoFactor,
            backupCodes: user.twoFactor.backupCodes,
          }
          await this.userRepository.update(parsedId, {
            twoFactor: user.twoFactor,
          })
          return true
        }
      }
    }

    return false
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

    await this.userRepository.update(parsedId, { twoFactor: user.twoFactor })
  }
}
