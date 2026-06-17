/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing'
import { AuthController } from './auth.controller'
import { AuthService } from './services/auth.service'
import { SignupService } from './services/signup.service'
import { PinService } from './services/pin.service'
import { UnauthorizedException } from '@nestjs/common'

describe('AuthController Integration', () => {
  let controller: AuthController
  let authService: AuthService

  const mockAuthService = {
    login: jest.fn(),
    authenticate2fa: jest.fn(),
    requestLoginOtp: jest.fn(),
  }

  const mockSignupService = {}
  const mockPinService = {}

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: SignupService,
          useValue: mockSignupService,
        },
        {
          provide: PinService,
          useValue: mockPinService,
        },
      ],
    }).compile()

    controller = module.get<AuthController>(AuthController)
    authService = module.get<AuthService>(AuthService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('login', () => {
    it('should return standard tokens if user does not have 2FA enabled', async () => {
      const standardResponse = {
        accessToken: 'access_token_jwt',
        refreshToken: 'refresh_token_jwt',
        user: { _id: 'user123', email: 'test@example.com', roles: ['tenant'] },
      }
      mockAuthService.login.mockResolvedValue(standardResponse)

      const result = await controller.login({
        emailOrPhone: 'test@example.com',
        password: 'password123',
      })

      expect(result).toEqual(standardResponse)
      expect(authService.login).toHaveBeenCalledWith(
        'test@example.com',
        'password123'
      )
    })

    it('should return is2faRequired and temp token if user has 2FA enabled', async () => {
      const twoFactorResponse = {
        is2faRequired: true,
        twoFactorTempToken: 'temp_token_jwt',
        user: { _id: 'user123', email: 'test@example.com' },
      }
      mockAuthService.login.mockResolvedValue(twoFactorResponse)

      const result = await controller.login({
        emailOrPhone: 'test@example.com',
        password: 'password123',
      })

      expect(result).toEqual(twoFactorResponse)
      expect(authService.login).toHaveBeenCalledWith(
        'test@example.com',
        'password123'
      )
    })
  })

  describe('authenticate2fa', () => {
    it('should exchange temp token and OTP code for JWT access/refresh tokens', async () => {
      const expectedResponse = {
        accessToken: 'access_token_jwt',
        refreshToken: 'refresh_token_jwt',
        user: { _id: 'user123', email: 'test@example.com', roles: ['tenant'] },
      }
      mockAuthService.authenticate2fa.mockResolvedValue(expectedResponse)

      const result = await controller.authenticate2fa({
        twoFactorTempToken: 'temp_token_jwt',
        code: '123456',
      })

      expect(result).toEqual(expectedResponse)
      expect(authService.authenticate2fa).toHaveBeenCalledWith(
        'temp_token_jwt',
        '123456'
      )
    })

    it('should throw UnauthorizedException if verification fails', async () => {
      mockAuthService.authenticate2fa.mockRejectedValue(
        new UnauthorizedException('Mã xác thực 2FA không chính xác')
      )

      await expect(
        controller.authenticate2fa({
          twoFactorTempToken: 'temp_token_jwt',
          code: '000000',
        })
      ).rejects.toThrow(UnauthorizedException)
    })
  })

  describe('requestLoginOtp', () => {
    it('should throw BadRequestException if 2FA is not enabled', async () => {
      const error = new Error(
        'Tài khoản chưa kích hoạt xác thực 2FA. Vui lòng đăng nhập bằng mật khẩu.'
      )
      mockAuthService.requestLoginOtp.mockRejectedValue(error)

      await expect(
        controller.requestLoginOtp({
          email: 'test@example.com',
        })
      ).rejects.toThrow(
        'Tài khoản chưa kích hoạt xác thực 2FA. Vui lòng đăng nhập bằng mật khẩu.'
      )
      expect(authService.requestLoginOtp).toHaveBeenCalledWith(
        'test@example.com'
      )
    })

    it('should return is2faRequired and temp token if 2FA is enabled', async () => {
      const twoFactorResponse = {
        is2faRequired: true,
        twoFactorTempToken: 'temp_token_jwt',
        user: { _id: 'user123', email: 'test@example.com' },
      }
      mockAuthService.requestLoginOtp.mockResolvedValue(twoFactorResponse)

      const result = await controller.requestLoginOtp({
        email: 'test@example.com',
      })

      expect(result).toEqual(twoFactorResponse)
      expect(authService.requestLoginOtp).toHaveBeenCalledWith(
        'test@example.com'
      )
    })
  })
})
