import { getMetadataArgsStorage } from 'typeorm'
import { ObjectId } from 'mongodb'
import { User, type KycInfo } from './user.schema'

describe('User.kyc (G-KYC)', () => {
  const kyc: KycInfo = {
    recordId: new ObjectId('64c000000000000000000001'),
    idCardNumber: '079123456789',
    frontCardUrl: 'kyc-media:f',
    backCardUrl: 'kyc-media:b',
    selfieUrl: 'kyc-media:s',
    status: 'pending',
    rejectedReason: null,
    verifiedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  }

  it('đăng ký @AfterLoad bỏ kyc khỏi entity vừa nạp để save(User) không đè hồ sơ', () => {
    const listeners = getMetadataArgsStorage().entityListeners.filter(
      listener => listener.target === User && listener.type === 'after-load'
    )

    expect(listeners.map(listener => listener.propertyName)).toContain(
      'stripKyc'
    )
  })

  it('stripKyc xóa kyc khỏi entity, không đụng các trường khác', () => {
    const user = Object.assign(new User(), { kyc, kycStatus: 'pending' })

    user.stripKyc?.()

    expect(user.kyc).toBeUndefined()
    expect(user.kycStatus).toBe('pending')
  })
})
