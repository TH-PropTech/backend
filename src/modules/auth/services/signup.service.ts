import { Injectable, BadRequestException, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as bcrypt from 'bcryptjs'
import { User, UserStatus } from '../../users/schemas/user.schema'
import { Notification } from '../../notifications/schemas/notification.schema'
import { EmailService } from './email.service'

import { IsString, IsEmail, IsIn } from 'class-validator'
import { EmailOtp } from '../schemas/email-otp.schema'

export class SignupDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string

  @IsString({ message: 'Số điện thoại phải là chuỗi' })
  phone!: string

  @IsString({ message: 'Mật khẩu phải là chuỗi' })
  password!: string

  @IsString({ message: 'Họ tên phải là chuỗi' })
  fullName!: string

  @IsIn(['tenant', 'landlord'], { message: 'Vai trò không hợp lệ' })
  role!: 'tenant' | 'landlord'

  @IsString({ message: 'Mã OTP phải là chuỗi' })
  otp!: string
}

@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name)

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(EmailOtp)
    private readonly emailOtpRepository: Repository<EmailOtp>,
    private readonly emailService: EmailService
  ) {}

  /**
   * Yêu cầu gửi mã OTP để đăng ký tài khoản mới
   */
  async requestSignupOtp(email: string, phone: string): Promise<void> {
    const existingEmail = await this.userRepository.findOne({
      where: { email },
    })
    if (existingEmail) {
      throw new BadRequestException('Email đã được đăng ký trên hệ thống')
    }

    const existingPhone = await this.userRepository.findOne({
      where: { phone },
    })
    if (existingPhone) {
      throw new BadRequestException(
        'Số điện thoại đã được đăng ký trên hệ thống'
      )
    }

    // Sinh OTP 6 chữ số ngẫu nhiên
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString()
    const expiredAt = new Date()
    expiredAt.setMinutes(expiredAt.getMinutes() + 5) // Hết hạn sau 5 phút

    const emailOtp = this.emailOtpRepository.create({
      email,
      otpCode,
      action: 'signup',
      isUsed: false,
      expiredAt,
    })

    await this.emailOtpRepository.save(emailOtp)

    // Gửi email OTP
    await this.emailService.sendOtpMail(email, otpCode, 'Đăng ký tài khoản')
  }

  /**
   * Đăng ký tài khoản cục bộ mới (yêu cầu OTP)
   */
  async signup(dto: SignupDto): Promise<User> {
    // A. Xác thực mã OTP đăng ký trước
    const otpRecord = await this.emailOtpRepository.findOne({
      where: {
        email: dto.email,
        otpCode: dto.otp,
        action: 'signup',
        isUsed: false,
      },
    })

    if (!otpRecord || new Date() > otpRecord.expiredAt) {
      throw new BadRequestException('Mã OTP không chính xác hoặc đã hết hạn')
    }

    otpRecord.isUsed = true
    await this.emailOtpRepository.save(otpRecord)

    // 1. Kiểm tra định dạng và dữ liệu trùng lặp
    const existingEmail = await this.userRepository.findOne({
      where: { email: dto.email },
    })
    if (existingEmail) {
      throw new BadRequestException('Email đã được đăng ký trên hệ thống')
    }

    const existingPhone = await this.userRepository.findOne({
      where: { phone: dto.phone },
    })
    if (existingPhone) {
      throw new BadRequestException(
        'Số điện thoại đã được đăng ký trên hệ thống'
      )
    }

    // 2. Mã hóa mật khẩu
    const passwordHash = await bcrypt.hash(dto.password, 10)

    // 3. Khởi tạo tài khoản
    const newUser = this.userRepository.create({
      email: dto.email,
      phone: dto.phone,
      fullName: dto.fullName,
      passwordHash,
      role: dto.role,
      status: UserStatus.ACTIVE,
      kycStatus: 'not-started',
      twoFactor: {
        enabled: false,
      },
      smartOTP: {
        enabled: false,
        maxDevices: 1,
        registeredDevices: 0,
        otpAttempts: 0,
      },
    })

    const savedUser = await this.userRepository.save(newUser)

    // Gửi email chào mừng thành viên mới
    try {
      await this.emailService.sendWelcomeMail(
        savedUser.email,
        savedUser.fullName
      )
    } catch (err) {
      this.logger.warn(
        `Không thể gửi email chào mừng tới ${savedUser.email}:`,
        err
      )
    }

    // 4. Tạo thông báo chào mừng
    try {
      const welcomeNotification = this.notificationRepository.create({
        userId: savedUser._id.toString(),
        title: 'Chào mừng thành viên mới!',
        body: `Chào mừng ${dto.fullName} đến với hệ thống TH PropTech. Vui lòng hoàn thành KYC để bắt đầu giao dịch căn hộ.`,
        type: 'SYSTEM',
        isRead: false,
        data: {},
      })
      await this.notificationRepository.save(welcomeNotification)
    } catch {
      // Bỏ qua lỗi gửi thông báo để không block luồng đăng ký chính
    }

    return savedUser
  }
}
