import { ObjectId } from 'mongodb'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { UsersController } from './users.controller'
import { UsersService } from '../services/users.service'
import { UpdateUserProfileDto } from '../dto/update-user-profile.dto'
import { NotificationPreferencesDto } from '../dto/notification-preferences.dto'

function userWithDevices(): Record<string, unknown> {
  return {
    _id: new ObjectId(),
    email: 'a@b.c',
    passwordHash: 'secret',
    pin: { hash: 'h', setAt: new Date(1) },
    twoFactor: { enabled: true, secret: 's', enabledAt: new Date(2) },
    smartOTP: {
      enabled: true,
      maxDevices: 2,
      registeredDevices: 1,
      otpAttempts: 0,
      devices: [
        {
          deviceId: 'd1',
          deviceName: 'Phone',
          publicKey: 'PUB',
          status: 'ACTIVE',
        },
      ],
    },
  }
}

describe('UsersController smartOTP exposure', () => {
  it('GET /users/me omits smartOTP.devices but keeps the other smartOTP fields', async () => {
    const user = userWithDevices()
    const repo = { findOne: jest.fn().mockResolvedValue(user) }
    const controller = new UsersController(repo as never)
    const result = await controller.getMe({
      user: { _id: (user._id as ObjectId).toHexString() },
    })

    expect(JSON.stringify(result)).not.toContain('PUB')
    expect(result.smartOTP).toEqual({
      enabled: true,
      maxDevices: 2,
      registeredDevices: 1,
      otpAttempts: 0,
    })
    expect(result).not.toHaveProperty('passwordHash')
    expect(result.hasPin).toBe(true)
    // the stored entity is not mutated
    expect((user.smartOTP as { devices?: unknown[] }).devices).toHaveLength(1)
  })

  it('GET /users omits smartOTP.devices for every user', async () => {
    const repo = {
      find: jest.fn().mockResolvedValue([userWithDevices(), userWithDevices()]),
    }
    const controller = new UsersController(repo as never)
    const result = await controller.getAll()
    expect(JSON.stringify(result)).not.toContain('PUB')
    expect(result).toHaveLength(2)
    expect((result[0] as { smartOTP?: unknown }).smartOTP).toEqual({
      enabled: true,
      maxDevices: 2,
      registeredDevices: 1,
      otpAttempts: 0,
    })
  })

  it('leaves users without smartOTP untouched', async () => {
    const user = { _id: new ObjectId(), email: 'x@y.z' }
    const repo = { findOne: jest.fn().mockResolvedValue(user) }
    const controller = new UsersController(repo as never)
    const result = await controller.getMe({
      user: { _id: user._id.toHexString() },
    })
    expect(result).not.toHaveProperty('smartOTP')
  })
})

describe('UsersController profile, notification preferences & sessions', () => {
  let controller: UsersController
  let mockUsersService: {
    updateProfile: jest.Mock
    getNotificationPreferences: jest.Mock
    updateNotificationPreferences: jest.Mock
    getUserSessions: jest.Mock
    revokeSession: jest.Mock
  }
  const userId = new ObjectId().toString()

  beforeEach(() => {
    mockUsersService = {
      updateProfile: jest.fn(),
      getNotificationPreferences: jest.fn(),
      updateNotificationPreferences: jest.fn(),
      getUserSessions: jest.fn(),
      revokeSession: jest.fn(),
    }
    controller = new UsersController(
      {} as never,
      mockUsersService as unknown as UsersService
    )
  })

  describe('PATCH /users/me', () => {
    it('updates fullName and phone via UsersService', async () => {
      const dto: UpdateUserProfileDto = {
        fullName: 'Nguyễn Văn B',
        phone: '0987654321',
      }
      mockUsersService.updateProfile.mockResolvedValue({
        _id: userId,
        fullName: 'Nguyễn Văn B',
        phone: '0987654321',
      })

      const res = await controller.updateMe({ user: { _id: userId } }, dto)
      expect(mockUsersService.updateProfile).toHaveBeenCalledWith(userId, dto)
      expect(res.fullName).toBe('Nguyễn Văn B')
    })

    it('rejects attempt to update email with 400 BadRequestException', async () => {
      const forbiddenDto = {
        fullName: 'Test',
        email: 'hacked@example.com',
      } as unknown as UpdateUserProfileDto

      await expect(
        controller.updateMe({ user: { _id: userId } }, forbiddenDto)
      ).rejects.toThrow(BadRequestException)
      expect(mockUsersService.updateProfile).not.toHaveBeenCalled()
    })

    it('rejects attempt to update idCardNumber with 400 BadRequestException', async () => {
      const forbiddenDto = {
        fullName: 'Test',
        idCardNumber: '012345678901',
      } as unknown as UpdateUserProfileDto

      await expect(
        controller.updateMe({ user: { _id: userId } }, forbiddenDto)
      ).rejects.toThrow(BadRequestException)
      expect(mockUsersService.updateProfile).not.toHaveBeenCalled()
    })
  })

  describe('GET & PUT /users/me/notification-preferences', () => {
    it('GET returns current notification preferences', async () => {
      mockUsersService.getNotificationPreferences.mockResolvedValue({
        email: true,
        push: false,
      })

      const res = await controller.getNotificationPreferences({
        user: { _id: userId },
      })
      expect(res).toEqual({ email: true, push: false })
      expect(mockUsersService.getNotificationPreferences).toHaveBeenCalledWith(
        userId
      )
    })

    it('PUT updates and returns new notification preferences', async () => {
      const dto: NotificationPreferencesDto = { email: false, push: true }
      mockUsersService.updateNotificationPreferences.mockResolvedValue(dto)

      const res = await controller.updateNotificationPreferences(
        { user: { _id: userId } },
        dto
      )
      expect(res).toEqual(dto)
      expect(
        mockUsersService.updateNotificationPreferences
      ).toHaveBeenCalledWith(userId, dto)
    })
  })

  describe('GET & DELETE /users/me/sessions', () => {
    it('GET returns list of sessions with current session flag', async () => {
      const sessionsResponse = {
        items: [
          {
            id: 'sess-1',
            deviceLabel: 'Chrome trên Windows',
            ipMasked: '113.161.45.*',
            lastActiveAt: new Date(),
            isCurrent: true,
          },
        ],
      }
      mockUsersService.getUserSessions.mockResolvedValue(sessionsResponse)

      const res = await controller.getSessions({
        user: { _id: userId, sessionId: 'sess-1' },
      })
      expect(res).toEqual(sessionsResponse)
      expect(mockUsersService.getUserSessions).toHaveBeenCalledWith(
        userId,
        'sess-1'
      )
    })

    it('DELETE revokes session successfully', async () => {
      mockUsersService.revokeSession.mockResolvedValue(undefined)

      await expect(
        controller.revokeSession('sess-2', {
          user: { _id: userId, sessionId: 'sess-1' },
        })
      ).resolves.toBeUndefined()

      expect(mockUsersService.revokeSession).toHaveBeenCalledWith(
        userId,
        'sess-2',
        'sess-1'
      )
    })

    it('DELETE propagates 400 BadRequestException when revoking current session', async () => {
      mockUsersService.revokeSession.mockRejectedValue(
        new BadRequestException('Không thể thu hồi phiên hiện tại')
      )

      await expect(
        controller.revokeSession('sess-1', {
          user: { _id: userId, sessionId: 'sess-1' },
        })
      ).rejects.toThrow(BadRequestException)
    })

    it('DELETE propagates 404 NotFoundException when session not found', async () => {
      mockUsersService.revokeSession.mockRejectedValue(
        new NotFoundException('Phiên không tồn tại')
      )

      await expect(
        controller.revokeSession('unknown-sess', {
          user: { _id: userId, sessionId: 'sess-1' },
        })
      ).rejects.toThrow(NotFoundException)
    })
  })
})
