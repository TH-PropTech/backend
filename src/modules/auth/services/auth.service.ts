import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { JwtService } from '@nestjs/jwt'
import { ObjectId } from 'mongodb'
import * as bcrypt from 'bcryptjs'
import { User, UserStatus } from '../../users/schemas/user.schema'
import { EmailOtp } from '../schemas/email-otp.schema'
import { EmailService } from './email.service'
import { TokenResponse, UserPayload } from '../interfaces/auth.interface'

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(EmailOtp)
    private readonly emailOtpRepository: Repository<EmailOtp>,
    private readonly emailService: EmailService,
    private readonly jwtService: JwtService
  ) {}

  /**
   * Đăng nhập bằng Email/SĐT và Mật khẩu cục bộ
   */
  async login(
    emailOrPhone: string,
    password: string
  ): Promise<TokenResponse & { user: UserPayload }> {
    let user = await this.userRepository.findOne({
      where: { email: emailOrPhone },
    })

    if (!user) {
      user = await this.userRepository.findOne({
        where: { phone: emailOrPhone },
      })
    }

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
   * Yêu cầu gửi mã OTP để đăng nhập không mật khẩu
   */
  async requestLoginOtp(email: string): Promise<void> {
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

    // Sinh OTP 6 chữ số ngẫu nhiên
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString()
    const expiredAt = new Date()
    expiredAt.setMinutes(expiredAt.getMinutes() + 5) // Hết hạn sau 5 phút

    const emailOtp = this.emailOtpRepository.create({
      email,
      otpCode,
      action: 'login',
      isUsed: false,
      expiredAt,
    })

    await this.emailOtpRepository.save(emailOtp)

    // Gửi email OTP
    await this.emailService.sendOtpMail(
      email,
      otpCode,
      'Đăng nhập không mật khẩu'
    )
  }

  /**
   * Xác thực mã OTP và tiến hành đăng nhập không mật khẩu
   */
  async verifyLoginOtp(
    email: string,
    otpCode: string
  ): Promise<TokenResponse & { user: UserPayload }> {
    const otpRecord = await this.emailOtpRepository.findOne({
      where: {
        email,
        otpCode,
        action: 'login',
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

    return this.generateAuthToken(user)
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

    const payload: UserPayload = {
      _id: user._id.toString(),
      email: user.email,
      name: user.fullName,
      phone: user.phone,
      username: user.email,
      roles: [user.role],
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
