import { Test, TestingModule } from '@nestjs/testing'
import { ObjectId } from 'mongodb'
import {
  SmartOtpController,
  BindDeviceDto,
  InitiateOtpDto,
  VerifyOtpDto,
} from './smart-otp.controller'
import { SmartOtpService } from '../services/smart-otp.service'
import { OtpActionType } from '../enums/otp-action-type.enum'
import { DeviceStatus } from '../enums/device-status.enum'
import { JwtAuthGuard } from '../guards/jwt-auth.guard'

describe('SmartOtpController', () => {
  let controller: SmartOtpController
  let mockService: {
    registerDevice: jest.Mock
    initiateOtpSession: jest.Mock
    verifyOtpSignature: jest.Mock
  }

  beforeEach(async () => {
    mockService = {
      registerDevice: jest.fn(),
      initiateOtpSession: jest.fn(),
      verifyOtpSignature: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SmartOtpController],
      providers: [
        {
          provide: SmartOtpService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<SmartOtpController>(SmartOtpController)
  })

  describe('bindDevice', () => {
    it('should prioritize authenticated current user ID over body userId', async () => {
      const dto: BindDeviceDto = {
        deviceId: 'device-123',
        deviceName: 'Chrome on Windows',
        publicKey: 'MOCK_PUBLIC_KEY',
        userId: 'spoofed-user-id',
      }

      mockService.registerDevice.mockResolvedValue({
        _id: new ObjectId(),
        userId: 'jwt-user-id',
        deviceId: 'device-123',
        deviceName: 'Chrome on Windows',
        publicKey: 'MOCK_PUBLIC_KEY',
        status: DeviceStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await controller.bindDevice(dto, 'jwt-user-id')

      expect(mockService.registerDevice).toHaveBeenCalledWith(
        'jwt-user-id',
        'device-123',
        'Chrome on Windows',
        'MOCK_PUBLIC_KEY'
      )
    })
  })

  describe('initiateOtp', () => {
    it('should derive user ID from JWT current user and return session details', async () => {
      const dto: InitiateOtpDto = {
        deviceId: 'device-123',
        action: OtpActionType.CONTRACT_SIGN,
      }

      mockService.initiateOtpSession.mockResolvedValue({
        sessionId: 'session-456',
        challenge: 'mock-challenge-hex',
        expiredAt: new Date(Date.now() + 300000),
        otpCode: '123456',
      })

      const result = await controller.initiateOtp(dto, 'jwt-user-id')

      expect(mockService.initiateOtpSession).toHaveBeenCalledWith(
        'jwt-user-id',
        'device-123',
        OtpActionType.CONTRACT_SIGN
      )
      expect(result.sessionId).toBe('session-456')
      expect(result.challenge).toBe('mock-challenge-hex')
    })
  })

  describe('verifyOtp', () => {
    it('should pass JWT current user to verification service', async () => {
      const dto: VerifyOtpDto = {
        sessionId: 'session-456',
        otpCode: '123456',
        signature: 'mock-sig',
      }

      mockService.verifyOtpSignature.mockResolvedValue({
        success: true,
        message: 'Xác thực Smart OTP thành công',
      })

      const result = await controller.verifyOtp(dto, 'jwt-user-id')

      expect(mockService.verifyOtpSignature).toHaveBeenCalledWith(
        'jwt-user-id',
        'session-456',
        '123456',
        'mock-sig'
      )
      expect(result.success).toBe(true)
    })
  })
})
