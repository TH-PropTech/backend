/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import * as bcrypt from 'bcryptjs'
import { TwoFactorService } from './two-factor.service'
import { User } from '../users/schemas/user.schema'
import { TotpService } from '../smart-otp/services/totp.service'
import { BadRequestException, NotFoundException } from '@nestjs/common'

describe('TwoFactorService', () => {
  let service: TwoFactorService
  let userRepository: Repository<User>
  let totpService: TotpService

  const mockUser = {
    _id: new ObjectId(),
    email: 'test@example.com',
    fullName: 'Test User',
    passwordHash: 'hashedpassword',
    phone: '0987654321',
    role: 'tenant',
    twoFactor: {
      enabled: false,
      secret: undefined,
      backupCodes: [],
    },
  } as unknown as User

  const mockUserRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  }

  const mockTotpService = {
    generateSecret: jest.fn().mockReturnValue('JBSWY3DPEHPK3PXP'),
    verifyToken: jest.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: TotpService,
          useValue: mockTotpService,
        },
      ],
    }).compile()

    service = module.get<TwoFactorService>(TwoFactorService)
    userRepository = module.get<Repository<User>>(getRepositoryToken(User))
    totpService = module.get<TotpService>(TotpService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('generate2faSecret', () => {
    it('should generate a secret and return qr details', async () => {
      mockUserRepository.findOne.mockResolvedValue({ ...mockUser })
      mockUserRepository.update.mockResolvedValue({} as any)

      const result = await service.generate2faSecret(mockUser._id.toString())

      expect(result).toHaveProperty('secret')
      expect(result).toHaveProperty('otpauthUrl')
      expect(userRepository.findOne).toHaveBeenCalled()
      expect(userRepository.update).toHaveBeenCalled()
    })

    it('should throw NotFoundException if user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null)

      await expect(
        service.generate2faSecret(new ObjectId().toString())
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('enable2fa', () => {
    it('should enable 2fa and return 10 backup codes', async () => {
      const userWithSecret = {
        ...mockUser,
        twoFactor: { enabled: false, secret: 'JBSWY3DPEHPK3PXP' },
      } as User
      mockUserRepository.findOne.mockResolvedValue(userWithSecret)
      mockTotpService.verifyToken.mockReturnValue(true)
      mockUserRepository.update.mockResolvedValue({} as any)

      const result = await service.enable2fa(mockUser._id.toString(), '123456')

      expect(result.success).toBe(true)
      expect(result.backupCodes).toHaveLength(10)
      expect(userWithSecret.twoFactor!.enabled).toBe(true)
      expect(userWithSecret.twoFactor!.backupCodes).toHaveLength(10)
      expect(userRepository.update).toHaveBeenCalled()
    })

    it('should throw BadRequestException if token is invalid', async () => {
      const userWithSecret = {
        ...mockUser,
        twoFactor: { enabled: false, secret: 'JBSWY3DPEHPK3PXP' },
      } as User
      mockUserRepository.findOne.mockResolvedValue(userWithSecret)
      mockTotpService.verifyToken.mockReturnValue(false)

      await expect(
        service.enable2fa(mockUser._id.toString(), '000000')
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('verify2fa', () => {
    it('should return true for valid OTP token', async () => {
      const userWith2fa = {
        ...mockUser,
        twoFactor: { enabled: true, secret: 'JBSWY3DPEHPK3PXP' },
      } as User
      mockUserRepository.findOne.mockResolvedValue(userWith2fa)
      mockTotpService.verifyToken.mockReturnValue(true)

      const isValid = await service.verify2fa(mockUser._id.toString(), '123456')

      expect(isValid).toBe(true)
    })

    it('should check backup codes if OTP verify fails', async () => {
      const plainBackupCode = 'abcd-1234'
      const hashedBackupCode = await bcrypt.hash(plainBackupCode, 10)
      const userWithBackup = {
        ...mockUser,
        twoFactor: {
          enabled: true,
          secret: 'JBSWY3DPEHPK3PXP',
          backupCodes: [hashedBackupCode],
        },
      } as User

      mockUserRepository.findOne.mockResolvedValue(userWithBackup)
      mockTotpService.verifyToken.mockReturnValue(false)
      mockUserRepository.update.mockResolvedValue({} as any)

      const isValid = await service.verify2fa(
        mockUser._id.toString(),
        plainBackupCode
      )

      expect(isValid).toBe(true)
      expect(userWithBackup.twoFactor!.backupCodes).toHaveLength(0) // Should consume the backup code
      expect(userRepository.update).toHaveBeenCalled()
    })
  })

  describe('disable2fa', () => {
    it('should disable 2fa for a user', async () => {
      const userWith2fa = {
        ...mockUser,
        twoFactor: { enabled: true, secret: 'JBSWY3DPEHPK3PXP' },
      } as User
      mockUserRepository.findOne.mockResolvedValue(userWith2fa)
      mockUserRepository.update.mockResolvedValue({} as any)

      await service.disable2fa(mockUser._id.toString())

      expect(userWith2fa.twoFactor!.enabled).toBe(false)
      expect(userWith2fa.twoFactor!.secret).toBeUndefined()
      expect(userRepository.update).toHaveBeenCalled()
    })
  })
})
