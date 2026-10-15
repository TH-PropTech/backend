import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { OtpSessionService } from './otp-session.service'
import type { Otp } from '../schemas/otp.schema'
import { OtpActionType } from '../enums/otp-action-type.enum'
import { OtpSessionStatus } from '../enums/otp-session-status.enum'
import { InMemoryOtpRepository } from '../utils/in-memory-otp-repository'

const future = (): Date => new Date(Date.now() + 60 * 60 * 1000)
const past = (): Date => new Date(Date.now() - 60 * 1000)

describe('OtpSessionService (phiên OTP giao dịch)', () => {
  let store: InMemoryOtpRepository
  let service: OtpSessionService
  const originalEnv = process.env.NODE_ENV

  beforeEach(() => {
    store = new InMemoryOtpRepository()
    service = new OtpSessionService(store as unknown as Repository<Otp>)
  })

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  function seedSession(overrides: Partial<Otp> = {}): Otp {
    const row = {
      _id: new ObjectId(),
      kind: 'transaction',
      userId: 'user-1',
      deviceId: 'device-1',
      action: OtpActionType.CONTRACT_SIGN,
      challenge: 'challenge-1',
      otpCode: '123456',
      status: OtpSessionStatus.INITIATED,
      attempts: 0,
      maxAttempts: 3,
      expiredAt: future(),
      contractId: 'contract-1',
      signerRole: 'tenant',
      contentLockedHash: 'hash-1',
      contextHash: null,
      consumedAt: null,
      ...overrides,
    } as Otp
    store.seed(row)
    return row
  }

  /** Bản ghi email cùng `_id`/trường với phiên giao dịch: không được lẫn vào. */
  function seedEmailRowWithSameId(id: ObjectId): void {
    store.seed({
      _id: id,
      kind: 'email',
      email: 'a@x.vn',
      otpCode: '123456',
      action: 'signup',
      isUsed: false,
      expiredAt: future(),
    })
  }

  it('creates a transaction session with a 5-minute expiry and empty counters', async () => {
    const before = Date.now()

    const session = await service.initiateSession(
      'user-1',
      'device-1',
      OtpActionType.PIN_SETUP,
      '654321',
      { contractId: 'contract-9' }
    )

    expect(session._id).toBeInstanceOf(ObjectId)
    expect(session.kind).toBe('transaction')
    expect(session.status).toBe(OtpSessionStatus.INITIATED)
    expect(session.attempts).toBe(0)
    expect(session.maxAttempts).toBe(3)
    expect(session.challenge).toMatch(/^[0-9a-f]{32}$/)
    expect(session.contractId).toBe('contract-9')
    expect(session.signerRole).toBeNull()
    expect(session.consumedAt).toBeNull()
    const ttl = session.expiredAt.getTime() - before
    expect(ttl).toBeGreaterThan(4.9 * 60 * 1000)
    expect(ttl).toBeLessThanOrEqual(5 * 60 * 1000 + 1000)
    expect(store.rows).toHaveLength(1)
  })

  describe('getSession', () => {
    it('returns the session by its id', async () => {
      const row = seedSession()

      const found = await service.getSession(row._id.toHexString())

      expect(found?._id.equals(row._id)).toBe(true)
    })

    it('returns null for a malformed id', async () => {
      seedSession()

      await expect(service.getSession('not-an-object-id')).resolves.toBeNull()
    })

    it('does not return an email-kind row that shares the same _id', async () => {
      const id = new ObjectId()
      seedEmailRowWithSameId(id)

      await expect(service.getSession(id.toHexString())).resolves.toBeNull()
    })
  })

  it('counts failed attempts and expires the session at maxAttempts', async () => {
    const row = seedSession({ attempts: 1 })
    const session = (await service.getSession(row._id.toHexString()))!

    await service.incrementAttempts(session)
    expect(session.attempts).toBe(2)
    expect(session.status).toBe(OtpSessionStatus.INITIATED)

    await service.incrementAttempts(session)
    expect(session.attempts).toBe(3)
    expect(session.status).toBe(OtpSessionStatus.EXPIRED)
    expect(store.first().status).toBe(OtpSessionStatus.EXPIRED)
    expect(store.first().attempts).toBe(3)
  })

  it('marks a session as verified', async () => {
    const row = seedSession()
    const session = (await service.getSession(row._id.toHexString()))!

    await service.markAsVerified(session)

    expect(store.first().status).toBe(OtpSessionStatus.VERIFIED)
  })

  describe('consumeVerifiedSession', () => {
    const ctx = {
      contractId: 'contract-1',
      signerRole: 'tenant',
      contentLockedHash: 'hash-1',
    }

    it('rejects an unknown session id', async () => {
      await expect(
        service.consumeVerifiedSession(
          'user-1',
          new ObjectId().toHexString(),
          OtpActionType.CONTRACT_SIGN
        )
      ).resolves.toEqual({
        valid: false,
        message: 'Không tìm thấy phiên xác thực OTP',
      })
    })

    it('rejects a session that belongs to another user', async () => {
      const row = seedSession({ status: OtpSessionStatus.VERIFIED })

      await expect(
        service.consumeVerifiedSession(
          'user-2',
          row._id.toHexString(),
          OtpActionType.CONTRACT_SIGN
        )
      ).resolves.toEqual({
        valid: false,
        message: 'Phiên xác thực không thuộc về tài khoản này',
      })
    })

    it('rejects a session of another action', async () => {
      const row = seedSession({ status: OtpSessionStatus.VERIFIED })

      await expect(
        service.consumeVerifiedSession(
          'user-1',
          row._id.toHexString(),
          OtpActionType.PIN_RESET
        )
      ).resolves.toEqual({
        valid: false,
        message: 'Loại phiên xác thực không phù hợp',
      })
    })

    it.each([
      [{ contractId: 'other' }, 'Mã hợp đồng không khớp với phiên OTP'],
      [{ signerRole: 'landlord' }, 'Vai trò người ký không khớp với phiên OTP'],
      [
        { contentLockedHash: 'changed' },
        'Mã băm nội dung hợp đồng đã thay đổi, vui lòng xác thực lại',
      ],
    ])('rejects a context mismatch %o', async (expected, message) => {
      const row = seedSession({ status: OtpSessionStatus.VERIFIED })

      await expect(
        service.consumeVerifiedSession(
          'user-1',
          row._id.toHexString(),
          OtpActionType.CONTRACT_SIGN,
          { ...ctx, ...expected }
        )
      ).resolves.toEqual({ valid: false, message })
    })

    it('accepts a CONSUMED session outside production and rejects it in production', async () => {
      const row = seedSession({ status: OtpSessionStatus.CONSUMED })

      process.env.NODE_ENV = 'test'
      await expect(
        service.consumeVerifiedSession(
          'user-1',
          row._id.toHexString(),
          OtpActionType.CONTRACT_SIGN,
          ctx
        )
      ).resolves.toEqual({ valid: true })

      process.env.NODE_ENV = 'production'
      await expect(
        service.consumeVerifiedSession(
          'user-1',
          row._id.toHexString(),
          OtpActionType.CONTRACT_SIGN,
          ctx
        )
      ).resolves.toEqual({
        valid: false,
        message: 'Mã xác thực đã được sử dụng trước đó',
      })
    })

    it('rejects a session that is not verified yet', async () => {
      const row = seedSession({ status: OtpSessionStatus.INITIATED })

      await expect(
        service.consumeVerifiedSession(
          'user-1',
          row._id.toHexString(),
          OtpActionType.CONTRACT_SIGN,
          ctx
        )
      ).resolves.toEqual({
        valid: false,
        message: 'Phiên xác thực chưa được xác minh hoặc đã quá hạn',
      })
      expect(store.first().status).toBe(OtpSessionStatus.INITIATED)
    })

    it('expires a verified session past its deadline and saves the expiry', async () => {
      const row = seedSession({
        status: OtpSessionStatus.VERIFIED,
        expiredAt: past(),
      })

      await expect(
        service.consumeVerifiedSession(
          'user-1',
          row._id.toHexString(),
          OtpActionType.CONTRACT_SIGN,
          ctx
        )
      ).resolves.toEqual({ valid: false, message: 'Phiên xác thực đã hết hạn' })
      expect(store.first().status).toBe(OtpSessionStatus.EXPIRED)
    })

    it('consumes a verified session once and then refuses it in production', async () => {
      const row = seedSession({ status: OtpSessionStatus.VERIFIED })
      process.env.NODE_ENV = 'production'

      await expect(
        service.consumeVerifiedSession(
          'user-1',
          row._id.toHexString(),
          OtpActionType.CONTRACT_SIGN,
          ctx
        )
      ).resolves.toEqual({ valid: true })
      expect(store.first().status).toBe(OtpSessionStatus.CONSUMED)
      expect(store.first().consumedAt).toBeInstanceOf(Date)

      await expect(
        service.consumeVerifiedSession(
          'user-1',
          row._id.toHexString(),
          OtpActionType.CONTRACT_SIGN,
          ctx
        )
      ).resolves.toEqual({
        valid: false,
        message: 'Mã xác thực đã được sử dụng trước đó',
      })
    })
  })
})
