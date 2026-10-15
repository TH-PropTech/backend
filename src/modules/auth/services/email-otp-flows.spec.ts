import { BadRequestException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { SignupService } from './signup.service'
import { AuthService } from './auth.service'
import type { Otp } from '../schemas/otp.schema'
import { InMemoryOtpRepository } from '../utils/in-memory-otp-repository'

const future = (): Date => new Date(Date.now() + 60 * 60 * 1000)
const past = (): Date => new Date(Date.now() - 60 * 1000)

describe('Luồng OTP email (đăng ký và quên mật khẩu)', () => {
  let otps: InMemoryOtpRepository
  let userRepo: {
    findOne: jest.Mock
    create: jest.Mock
    save: jest.Mock
    update: jest.Mock
  }
  let notificationRepo: { create: jest.Mock; save: jest.Mock }
  let emailService: {
    sendOtpMail: jest.Mock
    sendWelcomeMail: jest.Mock
  }
  let signup: SignupService
  let auth: AuthService

  beforeEach(() => {
    otps = new InMemoryOtpRepository()
    userRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: object) => value),
      save: jest.fn((value: object) =>
        Promise.resolve({ _id: new ObjectId(), ...value })
      ),
      update: jest.fn().mockResolvedValue({}),
    }
    notificationRepo = {
      create: jest.fn((value: object) => value),
      save: jest.fn().mockResolvedValue({}),
    }
    emailService = {
      sendOtpMail: jest.fn().mockResolvedValue(undefined),
      sendWelcomeMail: jest.fn().mockResolvedValue(undefined),
    }
    signup = new SignupService(
      userRepo as never,
      notificationRepo as never,
      otps as unknown as Repository<Otp>,
      emailService as never
    )
    auth = new AuthService(
      userRepo as never,
      otps as unknown as Repository<Otp>,
      emailService as never,
      {} as never,
      {} as never
    )
  })

  const signupDto = {
    email: 'new@x.vn',
    phone: '0900000001',
    password: 'Secret#123',
    fullName: 'Người Mới',
    role: 'tenant' as const,
  }

  /** Mã đã gửi qua email (đối số thứ hai của sendOtpMail). */
  function sentCode(): string {
    const call = emailService.sendOtpMail.mock.calls[0] as [string, string]
    return call[1]
  }

  function seedEmailOtp(overrides: Partial<Otp> = {}): Otp {
    const row = {
      _id: new ObjectId(),
      kind: 'email',
      email: signupDto.email,
      otpCode: '123456',
      action: 'signup',
      isUsed: false,
      expiredAt: future(),
      ...overrides,
    } as Otp
    otps.seed(row)
    return row
  }

  describe('đăng ký', () => {
    it('refuses to send a code to an email that is already registered', async () => {
      userRepo.findOne.mockResolvedValueOnce({ _id: new ObjectId() })

      await expect(
        signup.requestSignupOtp(signupDto.email, signupDto.phone)
      ).rejects.toThrow('Email đã được đăng ký trên hệ thống')
      expect(otps.rows).toHaveLength(0)
    })

    it('stores an email-kind signup code valid for 5 minutes and mails it', async () => {
      const before = Date.now()

      await signup.requestSignupOtp(signupDto.email, signupDto.phone)

      expect(otps.rows).toHaveLength(1)
      const row = otps.first()
      expect(row.kind).toBe('email')
      expect(row.email).toBe(signupDto.email)
      expect(row.action).toBe('signup')
      expect(row.isUsed).toBe(false)
      expect(sentCode()).toMatch(/^\d{6}$/)
      expect(row.otpCode).toBe(sentCode())
      const ttl = (row.expiredAt as Date).getTime() - before
      expect(ttl).toBeGreaterThan(4.9 * 60 * 1000)
      expect(ttl).toBeLessThanOrEqual(5 * 60 * 1000 + 1000)
      expect(emailService.sendOtpMail).toHaveBeenCalledWith(
        signupDto.email,
        sentCode(),
        'Đăng ký tài khoản'
      )
    })

    it('rejects a wrong code', async () => {
      seedEmailOtp({ otpCode: '111111' })

      await expect(
        signup.signup({ ...signupDto, otp: '222222' })
      ).rejects.toThrow(
        new BadRequestException('Mã OTP không chính xác hoặc đã hết hạn')
      )
      expect(userRepo.create).not.toHaveBeenCalled()
    })

    it('ignores a transaction-kind row that matches every other condition', async () => {
      otps.seed({
        _id: new ObjectId(),
        kind: 'transaction',
        email: signupDto.email,
        otpCode: '123456',
        action: 'signup',
        isUsed: false,
        expiredAt: future(),
      })

      await expect(
        signup.signup({ ...signupDto, otp: '123456' })
      ).rejects.toThrow('Mã OTP không chính xác hoặc đã hết hạn')
    })

    it('rejects an expired code', async () => {
      seedEmailOtp({ expiredAt: past() })

      await expect(
        signup.signup({ ...signupDto, otp: '123456' })
      ).rejects.toThrow('Mã OTP không chính xác hoặc đã hết hạn')
    })

    it('rejects a code that was already used', async () => {
      seedEmailOtp({ isUsed: true })

      await expect(
        signup.signup({ ...signupDto, otp: '123456' })
      ).rejects.toThrow('Mã OTP không chính xác hoặc đã hết hạn')
    })

    it('does not accept a forgot-password code for signup', async () => {
      seedEmailOtp({ action: 'forgot-password' })

      await expect(
        signup.signup({ ...signupDto, otp: '123456' })
      ).rejects.toThrow('Mã OTP không chính xác hoặc đã hết hạn')
    })

    it('marks the code used and creates the account with a valid code', async () => {
      const row = seedEmailOtp()

      const user = await signup.signup({ ...signupDto, otp: '123456' })

      expect(otps.rows.find(r => r._id!.equals(row._id))?.isUsed).toBe(true)
      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: signupDto.email,
          phone: signupDto.phone,
          role: 'tenant',
        })
      )
      expect(user.email).toBe(signupDto.email)
    })
  })

  describe('quên mật khẩu', () => {
    it('refuses to send a code for an unknown account', async () => {
      await expect(auth.requestForgotPasswordOtp('ghost@x.vn')).rejects.toThrow(
        'Tài khoản không tồn tại trên hệ thống'
      )
      expect(otps.rows).toHaveLength(0)
    })

    it('stores an email-kind forgot-password code and mails it', async () => {
      userRepo.findOne.mockResolvedValueOnce({ _id: new ObjectId() })

      await auth.requestForgotPasswordOtp(signupDto.email)

      expect(otps.rows).toHaveLength(1)
      expect(otps.first()).toMatchObject({
        kind: 'email',
        email: signupDto.email,
        action: 'forgot-password',
        isUsed: false,
      })
      expect(emailService.sendOtpMail).toHaveBeenCalledWith(
        signupDto.email,
        sentCode(),
        'Khôi phục mật khẩu'
      )
    })

    it('rejects a signup code and a transaction-kind row for password reset', async () => {
      seedEmailOtp({ action: 'signup', otpCode: '123456' })
      otps.seed({
        _id: new ObjectId(),
        kind: 'transaction',
        email: signupDto.email,
        otpCode: '654321',
        action: 'forgot-password',
        isUsed: false,
        expiredAt: future(),
      })

      await expect(
        auth.resetPasswordWithOtp(signupDto.email, '123456', 'New#pass1')
      ).rejects.toThrow('Mã OTP không chính xác hoặc đã hết hạn')
      await expect(
        auth.resetPasswordWithOtp(signupDto.email, '654321', 'New#pass1')
      ).rejects.toThrow('Mã OTP không chính xác hoặc đã hết hạn')
      expect(userRepo.update).not.toHaveBeenCalled()
    })

    it('rejects an expired or used forgot-password code', async () => {
      seedEmailOtp({ action: 'forgot-password', expiredAt: past() })
      seedEmailOtp({
        action: 'forgot-password',
        otpCode: '999999',
        isUsed: true,
      })

      await expect(
        auth.resetPasswordWithOtp(signupDto.email, '123456', 'New#pass1')
      ).rejects.toThrow('Mã OTP không chính xác hoặc đã hết hạn')
      await expect(
        auth.resetPasswordWithOtp(signupDto.email, '999999', 'New#pass1')
      ).rejects.toThrow('Mã OTP không chính xác hoặc đã hết hạn')
    })

    it('marks the code used and updates only the password field', async () => {
      const userId = new ObjectId()
      userRepo.findOne.mockResolvedValueOnce({ _id: userId })
      const row = seedEmailOtp({ action: 'forgot-password' })

      await auth.resetPasswordWithOtp(signupDto.email, '123456', 'New#pass1')

      expect(otps.rows.find(r => r._id!.equals(row._id))?.isUsed).toBe(true)
      expect(userRepo.update).toHaveBeenCalledTimes(1)
      const [id, patch] = userRepo.update.mock.calls[0] as [
        ObjectId,
        { passwordHash: string; updatedAt: Date },
      ]
      expect(id).toEqual(userId)
      expect(typeof patch.passwordHash).toBe('string')
      expect(patch.passwordHash).not.toBe('New#pass1')
      expect(patch.updatedAt).toBeInstanceOf(Date)
      expect(Object.keys(patch).sort()).toEqual(['passwordHash', 'updatedAt'])
    })

    it('keeps the code used even when the account disappeared', async () => {
      const row = seedEmailOtp({ action: 'forgot-password' })

      await expect(
        auth.resetPasswordWithOtp(signupDto.email, '123456', 'New#pass1')
      ).rejects.toThrow('Tài khoản không tồn tại')
      expect(otps.rows.find(r => r._id!.equals(row._id))?.isUsed).toBe(true)
      expect(userRepo.update).not.toHaveBeenCalled()
    })
  })
})
