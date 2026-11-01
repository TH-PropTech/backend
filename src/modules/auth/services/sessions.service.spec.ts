import { ObjectId } from 'mongodb'
import { UnauthorizedException } from '@nestjs/common'
import {
  SessionsService,
  parseDeviceLabel,
  maskIp,
  hashRefreshToken,
} from './sessions.service'
import { AuthSession } from '../schemas/auth-session.schema'

describe('SessionsService & Helpers', () => {
  describe('parseDeviceLabel', () => {
    it('parses Windows Chrome user-agent', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      expect(parseDeviceLabel(ua)).toBe('Chrome trên Windows')
    })

    it('parses iOS Safari user-agent', () => {
      const ua =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      expect(parseDeviceLabel(ua)).toBe('Safari trên iOS')
    })

    it('parses Android Chrome user-agent', () => {
      const ua =
        'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36'
      expect(parseDeviceLabel(ua)).toBe('Chrome trên Android')
    })

    it('parses macOS Firefox user-agent', () => {
      const ua =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/119.0'
      expect(parseDeviceLabel(ua)).toBe('Firefox trên macOS')
    })

    it('parses Edge on Windows user-agent', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
      expect(parseDeviceLabel(ua)).toBe('Edge trên Windows')
    })

    it('parses PostmanRuntime', () => {
      expect(parseDeviceLabel('PostmanRuntime/7.32.3')).toBe('Postman')
    })

    it('parses Android mobile app user-agent', () => {
      expect(parseDeviceLabel('okhttp/4.9.2 (Linux; Android 14; Mobile)')).toBe(
        'Ứng dụng di động Android'
      )
      expect(parseDeviceLabel('vn.thproptech.mobile/1.0.0 (Android 13)')).toBe(
        'Ứng dụng di động Android'
      )
    })

    it('parses iOS mobile app user-agent', () => {
      expect(
        parseDeviceLabel('CFNetwork/1410.0.3 Darwin/22.4.0 (iPhone)')
      ).toBe('Ứng dụng di động iOS')
    })

    it('returns fallback for unknown or empty user-agents', () => {
      expect(parseDeviceLabel('')).toBe('Thiết bị không xác định')
      expect(parseDeviceLabel(undefined)).toBe('Thiết bị không xác định')
      expect(parseDeviceLabel('CustomClient/1.0')).toBe(
        'Thiết bị không xác định'
      )
    })
  })

  describe('maskIp', () => {
    it('masks the last octet of IPv4 addresses', () => {
      expect(maskIp('113.161.45.102')).toBe('113.161.45.*')
      expect(maskIp('192.168.1.1')).toBe('192.168.1.*')
      expect(maskIp('10.0.0.254')).toBe('10.0.0.*')
    })

    it('masks IPv6-mapped IPv4 addresses cleanly', () => {
      expect(maskIp('::ffff:192.168.1.100')).toBe('192.168.1.*')
      expect(maskIp('::ffff:127.0.0.1')).toBe('127.0.0.*')
    })

    it('masks localhost and shorthand IPv6 addresses', () => {
      expect(maskIp('::1')).toBe('127.0.0.*')
      expect(maskIp('127.0.0.1')).toBe('127.0.0.*')
      expect(maskIp('::')).toBe('Mạng cục bộ')
    })

    it('masks IPv6 addresses', () => {
      expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe(
        '2001:db8:85a3::8a2e:370:*'
      )
    })

    it('handles empty or missing IP', () => {
      expect(maskIp('')).toBe('***')
      expect(maskIp(undefined)).toBe('***')
    })
  })

  describe('hashRefreshToken', () => {
    it('produces a 64-character SHA-256 hex string and is deterministic', () => {
      const hash1 = hashRefreshToken('refresh-token-abc')
      const hash2 = hashRefreshToken('refresh-token-abc')
      expect(hash1).toHaveLength(64)
      expect(hash1).toBe(hash2)
      expect(hash1).not.toBe('refresh-token-abc')
    })
  })

  describe('SessionsService operations', () => {
    let service: SessionsService
    let mockSessionRepo: {
      create: jest.Mock
      save: jest.Mock
      findOne: jest.Mock
      find: jest.Mock
    }
    let mockConfigService: {
      get: jest.Mock
    }

    beforeEach(() => {
      mockSessionRepo = {
        create: jest.fn(
          (dto: unknown) =>
            ({
              ...(dto as object),
              _id: (dto as { _id?: ObjectId })._id ?? new ObjectId(),
            }) as unknown as AuthSession
        ),
        save: jest.fn((entity: unknown) =>
          Promise.resolve({ ...(entity as object) } as unknown as AuthSession)
        ),
        findOne: jest.fn(),
        find: jest.fn(),
      }
      mockConfigService = {
        get: jest.fn(),
      }
      service = new SessionsService(
        mockSessionRepo as never,
        mockConfigService as never
      )
    })

    it('creates a session with hashed refresh token and parsed device label', async () => {
      const userId = new ObjectId()
      const rawRefreshToken = 'super-secret-refresh-token'
      const userAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      const ip = '14.162.210.55'

      const session = await service.createSession({
        userId,
        refreshToken: rawRefreshToken,
        userAgent,
        ip,
      })

      expect(mockSessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          refreshTokenHash: hashRefreshToken(rawRefreshToken),
          deviceLabel: 'Chrome trên Windows',
          ip,
          revokedAt: null,
        })
      )
      expect(mockSessionRepo.save).toHaveBeenCalled()
      expect(session.refreshTokenHash).not.toBe(rawRefreshToken)
    })

    it('rotates a valid session on token refresh', async () => {
      const oldToken = 'old-refresh-token'
      const newToken = 'new-refresh-token'
      const existingSession: AuthSession = {
        _id: new ObjectId(),
        userId: new ObjectId(),
        refreshTokenHash: hashRefreshToken(oldToken),
        userAgent: 'old-ua',
        deviceLabel: 'old-label',
        ip: '1.2.3.4',
        lastActiveAt: new Date(Date.now() - 3600000),
        createdAt: new Date(Date.now() - 3600000),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      }

      mockSessionRepo.findOne.mockResolvedValue(existingSession)

      const rotated = await service.rotateSession(oldToken, newToken, {
        ip: '5.6.7.8',
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      })

      expect(rotated).not.toBeNull()
      expect(rotated?.refreshTokenHash).toBe(hashRefreshToken(newToken))
      expect(rotated?.deviceLabel).toBe('Safari trên iOS')
      expect(rotated?.ip).toBe('5.6.7.8')
      expect(mockSessionRepo.save).toHaveBeenCalled()
    })

    it('returns null when rotating an unknown token (legacy token)', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null)
      const rotated = await service.rotateSession('unknown-token', 'new-token')
      expect(rotated).toBeNull()
    })

    it('rejects rotation with 401 when session has been revoked and enforcement is on', async () => {
      const oldToken = 'revoked-token'
      const revokedSession: AuthSession = {
        _id: new ObjectId(),
        userId: new ObjectId(),
        refreshTokenHash: hashRefreshToken(oldToken),
        userAgent: 'ua',
        deviceLabel: 'Chrome trên Windows',
        ip: '1.2.3.4',
        lastActiveAt: new Date(),
        createdAt: new Date(),
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      }

      mockSessionRepo.findOne.mockResolvedValue(revokedSession)
      mockConfigService.get.mockReturnValue('true') // default / true

      await expect(
        service.rotateSession(oldToken, 'new-token')
      ).rejects.toThrow(UnauthorizedException)
    })

    it('allows rotation if revoked when AUTH_SESSION_ENFORCE is explicitly disabled', async () => {
      const oldToken = 'revoked-token'
      const revokedSession: AuthSession = {
        _id: new ObjectId(),
        userId: new ObjectId(),
        refreshTokenHash: hashRefreshToken(oldToken),
        userAgent: 'ua',
        deviceLabel: 'Chrome trên Windows',
        ip: '1.2.3.4',
        lastActiveAt: new Date(),
        createdAt: new Date(),
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      }

      mockSessionRepo.findOne.mockResolvedValue(revokedSession)
      mockConfigService.get.mockReturnValue(false)

      const rotated = await service.rotateSession(oldToken, 'new-token')
      expect(rotated).not.toBeNull()
    })

    it('findActiveSessionsByUserId excludes revoked sessions', async () => {
      const userId = new ObjectId()
      const active1 = {
        _id: new ObjectId(),
        userId,
        revokedAt: null,
      } as AuthSession
      const active2 = {
        _id: new ObjectId(),
        userId,
        revokedAt: undefined,
      } as unknown as AuthSession
      const revoked = {
        _id: new ObjectId(),
        userId,
        revokedAt: new Date(),
      } as unknown as AuthSession

      mockSessionRepo.find.mockResolvedValue([active1, revoked, active2])

      const result = await service.findActiveSessionsByUserId(userId)
      expect(result).toHaveLength(2)
      expect(result).toEqual([active1, active2])
    })

    it('revokes a session by setting revokedAt', async () => {
      const userId = new ObjectId()
      const sessionId = new ObjectId()
      const session = {
        _id: sessionId,
        userId,
        revokedAt: null,
      } as AuthSession

      mockSessionRepo.findOne.mockResolvedValue(session)

      const ok = await service.revokeSession(userId, sessionId)
      expect(ok).toBe(true)
      expect(session.revokedAt).toBeInstanceOf(Date)
      expect(mockSessionRepo.save).toHaveBeenCalledWith(session)
    })

    it('returns false when revoking a non-existent or other user session', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null)
      const ok = await service.revokeSession(new ObjectId(), new ObjectId())
      expect(ok).toBe(false)
    })
  })
})
