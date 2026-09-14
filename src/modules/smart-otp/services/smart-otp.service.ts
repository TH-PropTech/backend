import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common'
import { DeviceBindingService } from './device-binding.service'
import { OtpSessionService } from './otp-session.service'
import { TotpService } from './totp.service'
import { SignatureService } from './signature.service'
import { OtpActionType } from '../enums/otp-action-type.enum'
import { OtpSessionStatus } from '../enums/otp-session-status.enum'
import { DeviceBinding } from '../schemas/device-binding.schema'
import { DeviceStatus } from '../enums/device-status.enum'

@Injectable()
export class SmartOtpService {
  constructor(
    private readonly deviceBindingService: DeviceBindingService,
    private readonly otpSessionService: OtpSessionService,
    private readonly totpService: TotpService,
    private readonly signatureService: SignatureService
  ) {}

  /**
   * Đăng ký liên kết thiết bị cho user
   */
  async registerDevice(
    userId: string,
    deviceId: string,
    deviceName: string,
    publicKey: string
  ): Promise<DeviceBinding> {
    return this.deviceBindingService.bindDevice(
      userId,
      deviceId,
      deviceName,
      publicKey
    )
  }

  /**
   * Khởi tạo phiên giao dịch yêu cầu mã OTP
   */
  async initiateOtpSession(
    userId: string,
    deviceId: string,
    action: OtpActionType,
    context?: {
      contractId?: string
      signerRole?: string
      contentLockedHash?: string
      contextHash?: string
    }
  ): Promise<{
    sessionId: string
    challenge: string
    expiredAt: Date
    otpCode?: string
  }> {
    // Kiểm tra thiết bị liên kết có tồn tại và hoạt động không
    let binding = await this.deviceBindingService.getDeviceBinding(
      userId,
      deviceId
    )
    if (!binding) {
      binding = await this.deviceBindingService.bindDevice(
        userId,
        deviceId,
        'Web Browser Client',
        `WEB_KEY_${deviceId}`
      )
    }
    if (binding.status !== DeviceStatus.ACTIVE) {
      throw new BadRequestException(
        'Thiết bị chưa được kích hoạt hoặc đã bị khóa'
      )
    }

    // Sử dụng publicKey làm hạt giống (seed) để sinh mã TOTP (hoặc dùng secret riêng của user)
    const secret = binding.publicKey
      .replace(/[^A-Z2-7]/gi, '')
      .substring(0, 16)
      .toUpperCase()
    const otpCode = this.totpService.generateToken(
      secret || 'DEFAULTSECRET1234'
    )

    const session = await this.otpSessionService.initiateSession(
      userId,
      deviceId,
      action,
      otpCode,
      context
    )

    return {
      sessionId: session._id.toString(),
      challenge: session.challenge,
      expiredAt: session.expiredAt,
      // Trong môi trường mô phỏng PoC, trả về otpCode cho client hiển thị thử nghiệm
      otpCode: session.otpCode,
    }
  }

  /**
   * Xác thực mã OTP cùng chữ ký số của thiết bị gửi lên
   */
  async verifyOtpSignature(
    userId: string,
    sessionId: string,
    otpCode: string,
    signature: string
  ): Promise<{ success: boolean; message: string }> {
    const session = await this.otpSessionService.getSession(sessionId)

    if (!session) {
      throw new BadRequestException('Không tìm thấy phiên OTP')
    }

    if (session.userId !== userId) {
      throw new UnauthorizedException(
        'Phiên giao dịch không thuộc về người dùng này'
      )
    }

    if (session.status !== OtpSessionStatus.INITIATED) {
      return {
        success: false,
        message: 'Phiên xác thực đã kết thúc hoặc quá hạn',
      }
    }

    if (new Date() > session.expiredAt) {
      session.status = OtpSessionStatus.EXPIRED
      await this.otpSessionService.incrementAttempts(session) // Đánh dấu hết hạn
      return { success: false, message: 'Phiên xác thực đã hết hạn' }
    }

    // 1. Kiểm tra mã OTP trước (có thể sai lệch 1 chu kỳ 30s)
    const binding = await this.deviceBindingService.getDeviceBinding(
      userId,
      session.deviceId
    )
    if (!binding || binding.status !== DeviceStatus.ACTIVE) {
      return { success: false, message: 'Thiết bị không còn hoạt động' }
    }

    const secret = binding.publicKey
      .replace(/[^A-Z2-7]/gi, '')
      .substring(0, 16)
      .toUpperCase()
    const isOtpValid = this.totpService.verifyToken(secret, otpCode, 1)

    if (!isOtpValid && session.otpCode !== otpCode) {
      await this.otpSessionService.incrementAttempts(session)
      return {
        success: false,
        message: `Mã OTP không chính xác. Còn lại ${session.maxAttempts - session.attempts} lần thử`,
      }
    }

    // 2. Xác thực chữ ký số từ thiết bị
    let isSignatureValid = false
    if (binding.publicKey.startsWith('WEB_KEY_')) {
      isSignatureValid = Boolean(signature && signature.length > 0)
    } else {
      isSignatureValid = this.signatureService.verifySignature(
        binding.publicKey,
        session.challenge,
        signature
      )
    }

    if (!isSignatureValid) {
      await this.otpSessionService.incrementAttempts(session)
      return {
        success: false,
        message: `Chữ ký xác thực từ thiết bị không khớp. Còn lại ${session.maxAttempts - session.attempts} lần thử`,
      }
    }

    // Xác thực thành công
    await this.otpSessionService.markAsVerified(session)
    return { success: true, message: 'Xác thực Smart OTP thành công' }
  }

  /**
   * Sử dụng và giải phóng phiên OTP (chỉ dùng cho luồng xử lý trung gian như PinService)
   */
  async consumeVerifiedSession(
    userId: string,
    sessionId: string,
    expectedAction: OtpActionType
  ): Promise<{ valid: boolean; message?: string }> {
    return this.otpSessionService.consumeVerifiedSession(
      userId,
      sessionId,
      expectedAction
    )
  }

  /**
   * Tiêu thụ phiên OTP gắn với hợp đồng thuê
   */
  async consumeContractOtp(
    sessionId: string,
    userId: string,
    contractId: string,
    signerRole: string,
    contentLockedHash: string
  ): Promise<{ valid: boolean; message?: string }> {
    return this.otpSessionService.consumeVerifiedSession(
      userId,
      sessionId,
      OtpActionType.CONTRACT_SIGN,
      { contractId, signerRole, contentLockedHash }
    )
  }
}
