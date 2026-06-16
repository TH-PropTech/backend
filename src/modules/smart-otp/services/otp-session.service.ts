import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as crypto from 'crypto'
import { ObjectId } from 'mongodb'
import { TransactionOtp } from '../schemas/transaction-otp.schema'
import { OtpActionType } from '../enums/otp-action-type.enum'
import { OtpSessionStatus } from '../enums/otp-session-status.enum'

@Injectable()
export class OtpSessionService {
  constructor(
    @InjectRepository(TransactionOtp)
    private readonly transactionOtpRepository: Repository<TransactionOtp>
  ) {}

  /**
   * Tạo phiên OTP mới
   */
  async initiateSession(
    userId: string,
    deviceId: string,
    action: OtpActionType,
    otpCode: string
  ): Promise<TransactionOtp> {
    const challenge = crypto.randomBytes(16).toString('hex')
    const expiredAt = new Date(Date.now() + 5 * 60 * 1000) // Hết hạn trong 5 phút

    const session = this.transactionOtpRepository.create({
      userId,
      deviceId,
      action,
      challenge,
      otpCode,
      status: OtpSessionStatus.INITIATED,
      attempts: 0,
      maxAttempts: 3,
      expiredAt,
    })

    return this.transactionOtpRepository.save(session)
  }

  /**
   * Tìm phiên OTP
   */
  async getSession(sessionId: string): Promise<TransactionOtp | null> {
    try {
      const parsedId = new ObjectId(sessionId)
      return this.transactionOtpRepository.findOne({
        where: { _id: parsedId },
      })
    } catch {
      return null
    }
  }

  /**
   * Cập nhật số lần thử sai của phiên OTP
   */
  async incrementAttempts(session: TransactionOtp): Promise<void> {
    session.attempts += 1
    if (session.attempts >= session.maxAttempts) {
      session.status = OtpSessionStatus.EXPIRED
    }
    await this.transactionOtpRepository.save(session)
  }

  /**
   * Đánh dấu phiên OTP đã xác thực thành công
   */
  async markAsVerified(session: TransactionOtp): Promise<void> {
    session.status = OtpSessionStatus.VERIFIED
    await this.transactionOtpRepository.save(session)
  }

  /**
   * Xác thực và thu hồi phiên OTP (dùng một lần)
   */
  async consumeVerifiedSession(
    userId: string,
    sessionId: string,
    expectedAction: OtpActionType
  ): Promise<{ valid: boolean; message?: string }> {
    const session = await this.getSession(sessionId)

    if (!session) {
      return { valid: false, message: 'Không tìm thấy phiên xác thực OTP' }
    }

    if (session.userId !== userId) {
      return {
        valid: false,
        message: 'Phiên xác thực không thuộc về tài khoản này',
      }
    }

    if (session.action !== expectedAction) {
      return { valid: false, message: 'Loại phiên xác thực không phù hợp' }
    }

    if (session.status === OtpSessionStatus.CONSUMED) {
      return { valid: false, message: 'Mã xác thực đã được sử dụng trước đó' }
    }

    if (session.status !== OtpSessionStatus.VERIFIED) {
      return {
        valid: false,
        message: 'Phiên xác thực chưa được xác minh hoặc đã quá hạn',
      }
    }

    if (new Date() > session.expiredAt) {
      session.status = OtpSessionStatus.EXPIRED
      await this.transactionOtpRepository.save(session)
      return { valid: false, message: 'Phiên xác thực đã hết hạn' }
    }

    // Đánh dấu đã sử dụng
    session.status = OtpSessionStatus.CONSUMED
    await this.transactionOtpRepository.save(session)

    return { valid: true }
  }
}
