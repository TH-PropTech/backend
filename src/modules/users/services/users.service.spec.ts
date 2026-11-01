/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ObjectId } from 'mongodb'
import { NotFoundException, BadRequestException } from '@nestjs/common'
import { UsersService } from './users.service'
import { User } from '../schemas/user.schema'
import { AuthSession } from '../../auth/schemas/auth-session.schema'

describe('UsersService', () => {
  let service: UsersService
  let mockUserRepo: {
    findOne: jest.Mock
    update: jest.Mock
  }
  let mockSessionsService: {
    findActiveSessionsByUserId: jest.Mock
    revokeSession: jest.Mock
  }

  beforeEach(() => {
    mockUserRepo = {
      findOne: jest.fn(),
      update: jest
        .fn()
        .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    }
    mockSessionsService = {
      findActiveSessionsByUserId: jest.fn(),
      revokeSession: jest.fn(),
    }
    service = new UsersService(
      mockUserRepo as never,
      mockSessionsService as never
    )
  })

  describe('getMe', () => {
    it('returns user profile without sensitive fields and with default notification preferences', async () => {
      const user: Partial<User> = {
        _id: new ObjectId(),
        fullName: 'Nguyễn Văn A',
        email: 'vana@example.com',
        phone: '0912345678',
        passwordHash: 'hash-password',
        pin: { hash: 'pin-hash', setAt: new Date() },
        twoFactor: { enabled: true, secret: 'secret', enabledAt: new Date() },
        smartOTP: {
          enabled: true,
          maxDevices: 2,
          registeredDevices: 1,
          otpAttempts: 0,
          devices: [
            {
              deviceId: 'd1',
              deviceName: 'iPhone',
              publicKey: 'PK',
              status: 'ACTIVE',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        },
      }
      mockUserRepo.findOne.mockResolvedValue(user)

      const result = await service.getMe(user._id!.toString())

      expect(result).not.toHaveProperty('passwordHash')
      expect(result).not.toHaveProperty('pin.hash')
      expect(result).not.toHaveProperty('twoFactor.secret')
      expect(result.smartOTP).toEqual({
        enabled: true,
        maxDevices: 2,
        registeredDevices: 1,
        otpAttempts: 0,
      })
      expect(result.notificationPreferences).toEqual({
        email: true,
        push: true,
      })
      expect(result.hasPin).toBe(true)
      expect(result.twoFactorEnabled).toBe(true)
    })

    it('throws NotFoundException when user does not exist', async () => {
      mockUserRepo.findOne.mockResolvedValue(null)
      await expect(service.getMe(new ObjectId().toString())).rejects.toThrow(
        NotFoundException
      )
    })

    it('throws NotFoundException when userId is not a valid ObjectId', async () => {
      await expect(service.getMe('invalid-id')).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('updateProfile', () => {
    it('updates fullName and valid phone', async () => {
      const userId = new ObjectId()
      const existingUser: Partial<User> = {
        _id: userId,
        fullName: 'Old Name',
        phone: '0901111111',
      }
      mockUserRepo.findOne
        .mockResolvedValueOnce(existingUser) // check user exists
        .mockResolvedValueOnce(null) // check duplicate phone
        .mockResolvedValueOnce({
          ...existingUser,
          fullName: 'New Name',
          phone: '0902222222',
        }) // getMe reload

      const result = await service.updateProfile(userId.toString(), {
        fullName: 'New Name',
        phone: '0902222222',
      })

      expect(mockUserRepo.update).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          fullName: 'New Name',
          phone: '0902222222',
        })
      )
      expect(result.fullName).toBe('New Name')
    })

    it('throws BadRequestException when phone is already used by another user', async () => {
      const userId = new ObjectId()
      const otherUserId = new ObjectId()
      mockUserRepo.findOne
        .mockResolvedValueOnce({ _id: userId, phone: '0901111111' })
        .mockResolvedValueOnce({ _id: otherUserId, phone: '0909999999' })

      await expect(
        service.updateProfile(userId.toString(), { phone: '0909999999' })
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('notification preferences', () => {
    it('getNotificationPreferences returns saved preferences or defaults', async () => {
      const userId = new ObjectId()
      mockUserRepo.findOne.mockResolvedValueOnce({
        _id: userId,
        notificationPreferences: { email: false, push: true },
      })

      const prefs = await service.getNotificationPreferences(userId.toString())
      expect(prefs).toEqual({ email: false, push: true })
    })

    it('updateNotificationPreferences updates preferences', async () => {
      const userId = new ObjectId()
      mockUserRepo.findOne.mockResolvedValueOnce({ _id: userId })

      const updated = await service.updateNotificationPreferences(
        userId.toString(),
        { email: false, push: false }
      )

      expect(mockUserRepo.update).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          notificationPreferences: { email: false, push: false },
        })
      )
      expect(updated).toEqual({ email: false, push: false })
    })
  })

  describe('sessions management', () => {
    it('getUserSessions masks IP and sets isCurrent for active session', async () => {
      const userId = new ObjectId()
      const currentSessionId = new ObjectId()
      const otherSessionId = new ObjectId()

      const sessions: AuthSession[] = [
        {
          _id: currentSessionId,
          userId,
          refreshTokenHash: 'hash1',
          userAgent: 'Chrome',
          deviceLabel: 'Chrome trên Windows',
          ip: '113.161.45.102',
          lastActiveAt: new Date(),
          createdAt: new Date(),
          revokedAt: null,
          expiresAt: new Date(),
        },
        {
          _id: otherSessionId,
          userId,
          refreshTokenHash: 'hash2',
          userAgent: 'Safari',
          deviceLabel: 'Safari trên iOS',
          ip: '14.162.210.55',
          lastActiveAt: new Date(Date.now() - 3600000),
          createdAt: new Date(),
          revokedAt: null,
          expiresAt: new Date(),
        },
      ]

      mockSessionsService.findActiveSessionsByUserId.mockResolvedValue(sessions)

      const result = await service.getUserSessions(
        userId.toString(),
        currentSessionId.toString()
      )

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        id: currentSessionId.toString(),
        deviceLabel: 'Chrome trên Windows',
        ipMasked: '113.161.45.*',
        lastActiveAt: expect.any(Date),
        isCurrent: true,
      })
      expect(result.items[1]?.isCurrent).toBe(false)
      expect(result.items[1]?.ipMasked).toBe('14.162.210.*')
    })

    it('revokeSession throws BadRequestException (400) if attempting to revoke current session', async () => {
      const currentSessionId = new ObjectId().toString()
      await expect(
        service.revokeSession(
          new ObjectId().toString(),
          currentSessionId,
          currentSessionId
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('revokeSession throws NotFoundException (404) if session does not exist or belongs to another user', async () => {
      mockSessionsService.revokeSession.mockResolvedValue(false)
      await expect(
        service.revokeSession(
          new ObjectId().toString(),
          new ObjectId().toString()
        )
      ).rejects.toThrow(NotFoundException)
    })

    it('revokeSession revokes session when valid and not current', async () => {
      mockSessionsService.revokeSession.mockResolvedValue(true)
      await expect(
        service.revokeSession(
          new ObjectId().toString(),
          new ObjectId().toString(),
          'other-session-id'
        )
      ).resolves.toBeUndefined()
    })
  })
})
