import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import * as bcrypt from 'bcryptjs'
import { User } from '../../users/schemas/user.schema'
import { SmartOtpService } from './smart-otp.service'
import { OtpActionType } from '../enums/otp-action-type.enum'

/**
 * PIN Service
 * Quản lý mã PIN 6 chữ số cho xác thực nhanh
 * PIN được hash bằng bcrypt trước khi lưu
 */
@Injectable()
export class PinService {
  private readonly logger = new Logger(PinService.name)
  private readonly BCRYPT_ROUNDS = 12

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly smartOtpService: SmartOtpService
  ) {}

  /**
   * Lấy trạng thái PIN của user
   */
  async getStatus(
    userId: string
  ): Promise<{ hasPin: boolean; pinSetAt?: Date }> {
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
      throw new UnauthorizedException('Không tìm thấy tài khoản người dùng')
    }

    const hasPin = !!user.pin?.hash
    if (hasPin && user.pin?.setAt) {
      return { hasPin, pinSetAt: user.pin.setAt }
    }
    return { hasPin }
  }

  /**
   * Thiết lập PIN lần đầu hoặc đặt lại PIN
   * Yêu cầu Smart OTP session đã xác thực (PIN_SETUP)
   */
  async setupPin(
    userId: string,
    pin: string,
    sessionId: string
  ): Promise<void> {
    // 1. Consume verified OTP session để xác nhận user đã xác thực
    const result = await this.smartOtpService.consumeVerifiedSession(
      userId,
      sessionId,
      OtpActionType.PIN_SETUP
    )

    if (!result.valid) {
      throw new BadRequestException(
        result.message || 'Xác thực Smart OTP thất bại'
      )
    }

    // 2. Hash PIN bằng bcrypt
    const hash = await bcrypt.hash(pin, this.BCRYPT_ROUNDS)

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
      throw new UnauthorizedException('Không tìm thấy tài khoản người dùng')
    }

    // 3. Lưu hashed PIN vào MongoDB
    // Ghi từng trường (không save toàn document) để không ghi đè smartOTP.devices
    await this.userRepository.update(user._id, {
      pin: { hash, setAt: new Date() },
      updatedAt: new Date(),
    })
    this.logger.log(`[PIN] User ${userId} setup PIN successfully`)
  }

  /**
   * Xác thực PIN (dùng khi cần verify PIN nhanh)
   */
  async verifyPin(userId: string, pin: string): Promise<boolean> {
    let parsedId: ObjectId
    try {
      parsedId = new ObjectId(userId)
    } catch {
      return false
    }

    const user = await this.userRepository.findOne({
      where: { _id: parsedId },
    })

    if (!user) {
      throw new UnauthorizedException('Không tìm thấy tài khoản người dùng')
    }

    const pinHash = user.pin?.hash
    if (!pinHash) return false
    return bcrypt.compare(pin, pinHash)
  }

  /**
   * Đổi mã PIN (xác nhận PIN cũ + Smart OTP)
   */
  async changePin(
    userId: string,
    oldPin: string,
    newPin: string,
    sessionId: string
  ): Promise<void> {
    // 1. Verify old PIN
    const isOldValid = await this.verifyPin(userId, oldPin)
    if (!isOldValid) {
      throw new BadRequestException('Mã PIN cũ không đúng')
    }

    // 2. Consume verified OTP session
    const result = await this.smartOtpService.consumeVerifiedSession(
      userId,
      sessionId,
      OtpActionType.PIN_CHANGE
    )
    if (!result.valid) {
      throw new BadRequestException(
        result.message || 'Xác thực Smart OTP thất bại'
      )
    }

    // 3. Hash new PIN
    const hash = await bcrypt.hash(newPin, this.BCRYPT_ROUNDS)

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
      throw new UnauthorizedException('Không tìm thấy tài khoản người dùng')
    }

    // 4. Save
    // Ghi từng trường (không save toàn document) để không ghi đè smartOTP.devices
    await this.userRepository.update(user._id, {
      pin: { hash, setAt: new Date() },
      updatedAt: new Date(),
    })
    this.logger.log(`[PIN] User ${userId} changed PIN successfully`)
  }

  /**
   * Reset mã PIN (quên PIN — chỉ cần Smart OTP, không cần PIN cũ)
   */
  async resetPin(
    userId: string,
    newPin: string,
    sessionId: string
  ): Promise<void> {
    // 1. Consume verified OTP session (PIN_RESET action)
    const result = await this.smartOtpService.consumeVerifiedSession(
      userId,
      sessionId,
      OtpActionType.PIN_RESET
    )
    if (!result.valid) {
      throw new BadRequestException(
        result.message || 'Xác thực Smart OTP thất bại'
      )
    }

    // 2. Hash new PIN
    const hash = await bcrypt.hash(newPin, this.BCRYPT_ROUNDS)

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
      throw new UnauthorizedException('Không tìm thấy tài khoản người dùng')
    }

    // 3. Save
    // Ghi từng trường (không save toàn document) để không ghi đè smartOTP.devices
    await this.userRepository.update(user._id, {
      pin: { hash, setAt: new Date() },
      updatedAt: new Date(),
    })
    this.logger.log(
      `[PIN] User ${userId} reset PIN successfully (forgot PIN flow)`
    )
  }
}
