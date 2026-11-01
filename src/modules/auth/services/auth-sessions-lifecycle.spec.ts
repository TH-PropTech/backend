/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ObjectId } from 'mongodb'
import { UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { AuthService } from './auth.service'
import { SessionsService, hashRefreshToken } from './sessions.service'
import { User, UserStatus } from '../../users/schemas/user.schema'
import { AuthSession } from '../schemas/auth-session.schema'

describe('Auth & Sessions Lifecycle Integration', () => {
  let authService: AuthService
  let sessionsService: SessionsService
  let jwtService: JwtService

  // In-memory session store simulating MongoDB collection
  const sessionDb: Map<string, AuthSession> = new Map()

  const mockSessionRepo = {
    create: jest.fn((dto: Partial<AuthSession>) => {
      const id = dto._id ?? new ObjectId()
      return { ...dto, _id: id } as AuthSession
    }),
    save: jest.fn((entity: AuthSession) => {
      sessionDb.set(entity._id.toString(), { ...entity })
      return Promise.resolve({ ...entity })
    }),
    findOne: jest.fn(
      ({
        where,
      }: {
        where: {
          refreshTokenHash?: string
          _id?: ObjectId | string
          userId?: ObjectId | string
        }
      }) => {
        for (const session of sessionDb.values()) {
          if (
            where.refreshTokenHash &&
            session.refreshTokenHash === where.refreshTokenHash
          ) {
            return Promise.resolve({ ...session })
          }
          if (where._id && session._id.toString() === where._id.toString()) {
            if (
              where.userId &&
              session.userId.toString() !== where.userId.toString()
            ) {
              continue
            }
            return Promise.resolve({ ...session })
          }
        }
        return Promise.resolve(null)
      }
    ),
    find: jest.fn(({ where }: { where: { userId?: ObjectId | string } }) => {
      const results: AuthSession[] = []
      for (const session of sessionDb.values()) {
        if (
          where.userId &&
          session.userId.toString() === where.userId.toString()
        ) {
          results.push({ ...session })
        }
      }
      return Promise.resolve(results)
    }),
  }

  const mockConfigService = {
    get: jest.fn().mockReturnValue(true), // AUTH_SESSION_ENFORCE = true
  }

  const testUser: User = {
    _id: new ObjectId(),
    fullName: 'Test User',
    email: 'user@example.com',
    phone: '0912345678',
    passwordHash: '',
    role: 'tenant',
    status: UserStatus.ACTIVE,
    kycStatus: 'verified',
    walletAddress: null,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockUserRepo = {
    findOne: jest.fn(
      ({ where }: { where: { _id?: ObjectId | string; $or?: unknown } }) => {
        if (where._id && where._id.toString() === testUser._id.toString()) {
          return Promise.resolve(testUser)
        }
        if (where.$or) {
          return Promise.resolve(testUser)
        }
        return Promise.resolve(null)
      }
    ),
  }

  beforeAll(async () => {
    testUser.passwordHash = await bcrypt.hash('secretPassword123', 10)
  })

  beforeEach(() => {
    sessionDb.clear()
    jwtService = new JwtService({ secret: 'test-secret-key-1234567890' })
    sessionsService = new SessionsService(
      mockSessionRepo as never,
      mockConfigService as never
    )
    authService = new AuthService(
      mockUserRepo as never,
      { findOne: jest.fn(), create: jest.fn(), save: jest.fn() } as never,
      {} as never,
      jwtService,
      {} as never,
      sessionsService
    )
  })

  it('completes the full session lifecycle: login -> refresh -> revoke -> refresh rejection', async () => {
    // 1. LOGIN
    const loginResult = (await authService.login(
      'user@example.com',
      'secretPassword123',
      {
        ip: '113.161.45.102',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    )) as { accessToken: string; refreshToken: string }

    expect(loginResult).toHaveProperty('accessToken')
    expect(loginResult).toHaveProperty('refreshToken')

    // Verify session record was created
    expect(sessionDb.size).toBe(1)
    const firstEntry = Array.from(sessionDb.entries())[0]!
    const [sessionId, session] = firstEntry
    expect(session.userId.toString()).toBe(testUser._id.toString())
    expect(session.deviceLabel).toBe('Chrome trên Windows')
    expect(session.ip).toBe('113.161.45.102')
    expect(session.revokedAt).toBeNull()

    // SECURITY CHECK: Verify raw refresh token is NEVER stored in database
    expect(session.refreshTokenHash).toBe(
      hashRefreshToken(loginResult.refreshToken)
    )
    expect(session.refreshTokenHash).not.toBe(loginResult.refreshToken)

    // Verify JWT payload includes sessionId
    const decodedAccess = jwtService.verify(loginResult.accessToken)
    expect(decodedAccess).toHaveProperty('sessionId', sessionId)

    // 2. REFRESH TOKEN ROTATION
    const refreshResult = await authService.refresh(loginResult.refreshToken, {
      ip: '113.161.45.105',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    })

    expect(refreshResult.accessToken).toBeDefined()
    expect(refreshResult.refreshToken).toBeDefined()
    expect(refreshResult.refreshToken).not.toBe(loginResult.refreshToken)

    // Verify session was rotated (same sessionId, new refreshTokenHash)
    expect(sessionDb.size).toBe(1)
    const updatedSession = sessionDb.get(sessionId)!
    expect(updatedSession.refreshTokenHash).toBe(
      hashRefreshToken(refreshResult.refreshToken)
    )
    expect(updatedSession.refreshTokenHash).not.toBe(
      hashRefreshToken(loginResult.refreshToken)
    )
    expect(updatedSession.ip).toBe('113.161.45.105')

    // 3. REVOKE SESSION
    const revokeSuccess = await sessionsService.revokeSession(
      testUser._id,
      sessionId
    )
    expect(revokeSuccess).toBe(true)

    const revokedSession = sessionDb.get(sessionId)!
    expect(revokedSession.revokedAt).toBeInstanceOf(Date)

    // 4. REFRESH WITH REVOKED SESSION REJECTS (401 Unauthorized)
    await expect(
      authService.refresh(refreshResult.refreshToken)
    ).rejects.toThrow(UnauthorizedException)
  })

  it('handles legacy tokens without session record by accepting once and creating session', async () => {
    // Generate legacy refresh token without existing session in database
    const payload = {
      _id: testUser._id.toString(),
      email: testUser.email,
      name: testUser.fullName,
      roles: ['tenant'],
    }
    const legacyRefreshToken = jwtService.sign(payload, { expiresIn: '7d' })

    expect(sessionDb.size).toBe(0)

    // Refresh using legacy token
    const refreshResult = await authService.refresh(legacyRefreshToken, {
      ip: '14.162.210.55',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })

    expect(refreshResult.accessToken).toBeDefined()
    expect(refreshResult.refreshToken).toBeDefined()

    // Verify session record was automatically created for legacy user
    expect(sessionDb.size).toBe(1)
    const session = Array.from(sessionDb.values())[0]!
    expect(session.userId.toString()).toBe(testUser._id.toString())
    expect(session.deviceLabel).toBe('Safari trên iOS')
    expect(session.ip).toBe('14.162.210.55')
    expect(session.refreshTokenHash).toBe(
      hashRefreshToken(refreshResult.refreshToken)
    )
  })

  it('requires 2FA code during login when user has twoFactor enabled', async () => {
    const userWith2fa: User = {
      ...testUser,
      _id: new ObjectId(),
      email: '2fa-user@example.com',
      twoFactor: {
        enabled: true,
        secret: 'TESTSECRET2FA',
      },
    }

    mockUserRepo.findOne.mockImplementation(
      ({ where }: { where: { _id?: ObjectId | string; $or?: unknown } }) => {
        const orList = where.$or as
          | Array<{ email?: string; phone?: string }>
          | undefined
        const matches2fa = orList?.some(c => c.email === '2fa-user@example.com')
        if (matches2fa) {
          return Promise.resolve(userWith2fa)
        }
        return Promise.resolve(testUser)
      }
    )

    const loginResult = await authService.login(
      '2fa-user@example.com',
      'secretPassword123'
    )

    expect('is2faRequired' in loginResult).toBe(true)
    if ('is2faRequired' in loginResult) {
      expect(loginResult.is2faRequired).toBe(true)
      expect(loginResult.twoFactorTempToken).toBeDefined()
      expect(loginResult.user.email).toBe('2fa-user@example.com')
    }
  })
})
