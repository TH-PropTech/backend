import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, FindOptionsWhere } from 'typeorm'
import { JwtService } from '@nestjs/jwt'
import { ObjectId } from 'mongodb'
import * as bcrypt from 'bcryptjs'
import { User, UserStatus } from '../../users/schemas/user.schema'
import { EmailOtp } from '../schemas/email-otp.schema'
import { EmailService } from './email.service'
import { TokenResponse, UserPayload } from '../interfaces/auth.interface'
import { TwoFactorService } from '../../two-factor/two-factor.service'

interface TwoFactorTempPayload {
  _id: string
  is2faTemp: boolean
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(EmailOtp)
    private readonly emailOtpRepository: Repository<EmailOtp>,
    private readonly emailService: EmailService,
    private readonly jwtService: JwtService,
    private readonly twoFactorService: TwoFactorService
  ) {}

  /**
   * Đăng nhập bằng Email/SĐT và Mật khẩu cục bộ
   */
  async login(
    emailOrPhone: string,
    password: string
  ): Promise<TokenResponse & { user: UserPayload }> {
    const user = await this.userRepository.findOne({
      where: {
        $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
      } as unknown as FindOptionsWhere<User>,
    })

    if (!user) {
      throw new UnauthorizedException('Tài khoản hoặc mật khẩu không chính xác')
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash)
    if (!isPasswordValid) {
      throw new UnauthorizedException('Tài khoản hoặc mật khẩu không chính xác')
    }

    return this.generateAuthToken(user)
  }

  /**
   * Xác thực mã 2FA bằng temp token để lấy JWT chính thức
   */
  async authenticate2fa(
    twoFactorTempToken: string,
    code: string
  ): Promise<TokenResponse & { user: UserPayload }> {
    let payload: TwoFactorTempPayload | null = null
    try {
      payload = this.jwtService.verify<TwoFactorTempPayload>(twoFactorTempToken)
    } catch {
      throw new UnauthorizedException(
        'Token xác thực tạm thời đã hết hạn hoặc không hợp lệ'
      )
    }

    if (!payload || !payload._id || !payload.is2faTemp) {
      throw new UnauthorizedException('Token xác thực tạm thời không hợp lệ')
    }

    const isValid = await this.twoFactorService.verify2fa(payload._id, code)
    if (!isValid) {
      throw new UnauthorizedException('Mã xác thực 2FA không chính xác')
    }

    const user = await this.validateUserById(payload._id)
    if (!user) {
      throw new UnauthorizedException('Tài khoản không tồn tại')
    }

    return this.generateAuthToken(user)
  }

  /**
   * Yêu cầu đăng nhập không mật khẩu (qua 2FA trực tiếp)
   */
  async requestLoginOtp(email: string): Promise<{
    is2faRequired: boolean
    twoFactorTempToken: string
    user: {
      _id: string
      email: string
    }
  }> {
    const user = await this.userRepository.findOne({
      where: { email },
    })

    if (!user) {
      throw new BadRequestException('Tài khoản không tồn tại trên hệ thống')
    }

    if (
      user.status === UserStatus.INACTIVE ||
      user.status === UserStatus.SUSPENDED
    ) {
      throw new BadRequestException(
        'Tài khoản đã bị tạm khóa hoặc ngừng hoạt động'
      )
    }

    // Nếu tài khoản đã kích hoạt 2FA, trả về token tạm thời để nhập 2FA
    if (user.twoFactor && user.twoFactor.enabled) {
      const twoFactorTempToken = this.jwtService.sign(
        { _id: user._id.toString(), is2faTemp: true },
        { expiresIn: '5m' }
      )
      return {
        is2faRequired: true,
        twoFactorTempToken,
        user: {
          _id: user._id.toString(),
          email: user.email,
        },
      }
    }

    // Nếu chưa kích hoạt 2FA, không gửi OTP mà chặn luôn
    throw new BadRequestException(
      'Tài khoản chưa kích hoạt xác thực 2FA. Vui lòng đăng nhập bằng mật khẩu.'
    )
  }

  /**
   * Yêu cầu gửi mã OTP để khôi phục mật khẩu (Quên mật khẩu)
   */
  async requestForgotPasswordOtp(email: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { email },
    })

    if (!user) {
      throw new BadRequestException('Tài khoản không tồn tại trên hệ thống')
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString()
    const expiredAt = new Date()
    expiredAt.setMinutes(expiredAt.getMinutes() + 5)

    const emailOtp = this.emailOtpRepository.create({
      email,
      otpCode,
      action: 'forgot-password',
      isUsed: false,
      expiredAt,
    })

    await this.emailOtpRepository.save(emailOtp)

    // Gửi email OTP khôi phục
    await this.emailService.sendOtpMail(email, otpCode, 'Khôi phục mật khẩu')
  }

  /**
   * Đặt lại mật khẩu mới bằng mã OTP
   */
  async resetPasswordWithOtp(
    email: string,
    otpCode: string,
    newPassword: string
  ): Promise<void> {
    const otpRecord = await this.emailOtpRepository.findOne({
      where: {
        email,
        otpCode,
        action: 'forgot-password',
        isUsed: false,
      },
    })

    if (!otpRecord || new Date() > otpRecord.expiredAt) {
      throw new BadRequestException('Mã OTP không chính xác hoặc đã hết hạn')
    }

    otpRecord.isUsed = true
    await this.emailOtpRepository.save(otpRecord)

    const user = await this.userRepository.findOne({
      where: { email },
    })

    if (!user) {
      throw new BadRequestException('Tài khoản không tồn tại')
    }

    // Cập nhật mật khẩu mới
    user.passwordHash = await bcrypt.hash(newPassword, 10)
    await this.userRepository.save(user)
  }

  /**
   * Xác thực người dùng bằng JWT Payload (Dùng cho Strategy / Guard)
   */
  async validateUserById(userId: string): Promise<User | null> {
    try {
      const parsedId = new ObjectId(userId)
      return this.userRepository.findOne({
        where: { _id: parsedId },
      })
    } catch {
      return null
    }
  }

  /**
   * Làm mới access token từ refresh token
   */
  async refresh(
    refreshToken: string
  ): Promise<TokenResponse & { user: UserPayload }> {
    try {
      const payload = this.jwtService.verify<UserPayload>(refreshToken)
      if (!payload || !payload._id) {
        throw new UnauthorizedException('Refresh token không hợp lệ')
      }

      const user = await this.validateUserById(payload._id)
      if (!user) {
        throw new UnauthorizedException('Tài khoản không tồn tại trên hệ thống')
      }

      return this.generateAuthToken(user)
    } catch (err) {
      throw new UnauthorizedException(
        err instanceof UnauthorizedException
          ? err.message
          : 'Refresh token đã hết hạn hoặc không hợp lệ'
      )
    }
  }

  /**
   * Hàm phụ trợ sinh token JWT
   */
  private generateAuthToken(user: User): TokenResponse & { user: UserPayload } {
    if (
      user.status === UserStatus.INACTIVE ||
      user.status === UserStatus.SUSPENDED
    ) {
      throw new BadRequestException(
        'Tài khoản đã bị tạm khóa hoặc ngừng hoạt động'
      )
    }

    const roles =
      user.role === 'tenant' || user.role === 'landlord'
        ? ['tenant', 'landlord']
        : [user.role]

    const payload: UserPayload = {
      _id: user._id.toString(),
      email: user.email,
      name: user.fullName,
      phone: user.phone,
      username: user.email,
      roles,
      kycStatus: user.kycStatus,
    }

    const accessToken = this.jwtService.sign(payload, { expiresIn: '1d' })
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' })

    return {
      accessToken,
      refreshToken,
      user: payload,
    }
  }
}
