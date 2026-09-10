import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'

import type { BiometricGrantService } from './biometric-grant.service'
import type { KycMediaService } from './kyc-media.service'
import { KycService } from './kyc.service'
import type { KycRecord } from './schemas/kyc-record.schema'
import type { User } from '../users/schemas/user.schema'

function createImage(fieldname: string): Express.Multer.File {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb])
  return {
    fieldname,
    originalname: `${fieldname}.jpg`,
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as unknown as Express.Multer.File['stream'],
  }
}

function createService(options?: { grantError?: Error }): {
  service: KycService
  kycRepository: { findOne: jest.Mock; save: jest.Mock }
  userRepository: { findOne: jest.Mock; save: jest.Mock }
  media: jest.Mocked<Pick<KycMediaService, 'store' | 'read' | 'remove'>>
} {
  const grantError = options?.grantError
  const user = {
    _id: new ObjectId('507f1f77bcf86cd799439011'),
    kycStatus: 'not-started',
  } as User
  const kycRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((record: KycRecord) =>
      Promise.resolve({
        ...record,
        _id: new ObjectId('507f1f77bcf86cd799439012'),
        createdAt: new Date('2026-09-06T00:00:00Z'),
        updatedAt: new Date('2026-09-06T00:00:00Z'),
      })
    ),
  }
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(user),
    save: jest.fn().mockImplementation(value => Promise.resolve(value)),
  }
  const media = {
    store: jest
      .fn()
      .mockImplementation((_userId: string, kind: string) =>
        Promise.resolve(`kyc-media:507f1f77bcf86cd799439011:${kind}`)
      ),
    remove: jest.fn().mockResolvedValue(undefined),
    read: jest.fn().mockResolvedValue({
      buffer: Buffer.from('image'),
      mimetype: 'image/jpeg' as const,
    }),
  }
  const grants = {
    consume: grantError
      ? jest.fn(() => {
          throw grantError
        })
      : jest.fn().mockReturnValue({
          verified: true,
          faceMatch: true,
          liveness: true,
          realConfidence: 0.93,
        }),
  }
  const service = Object.create(KycService.prototype) as KycService
  Reflect.set(service, 'logger', { log: jest.fn(), warn: jest.fn() })
  Reflect.set(service, 'kycRepository', kycRepository)
  Reflect.set(service, 'userRepository', userRepository)
  Reflect.set(service, 'kycMediaService', media as unknown as KycMediaService)
  Reflect.set(
    service,
    'biometricGrantService',
    grants as unknown as BiometricGrantService
  )

  return { service, kycRepository, userRepository, media }
}

describe('KycService.submitKyc', () => {
  const userId = '507f1f77bcf86cd799439011'
  const dto = {
    idCardNumber: '079123456789',
    fullName: 'Nguyen Van A',
  }
  const files = {
    frontCard: createImage('frontCard'),
    backCard: createImage('backCard'),
    selfie: createImage('selfie'),
  }

  it('stores private references and server-owned biometric results', async () => {
    const { service, kycRepository } = createService()

    const result = await service.submitKyc(userId, dto, files)

    expect(result.frontCardUrl).toBe(`kyc-media:${userId}:front-card`)
    expect(result.faceMatchResult).toBe(true)
    expect(result.livenessResult).toBe(true)
    expect(result.spoofScore).toBe(0.93)
    expect(kycRepository.save).toHaveBeenCalledTimes(1)
  })

  it('does not persist without a current biometric grant', async () => {
    const { service, kycRepository } = createService({
      grantError: new UnprocessableEntityException('expired'),
    })

    await expect(service.submitKyc(userId, dto, files)).rejects.toBeInstanceOf(
      UnprocessableEntityException
    )
    expect(kycRepository.save).not.toHaveBeenCalled()
  })

  it('removes newly stored media if database persistence fails', async () => {
    const { service, kycRepository, media } = createService()
    kycRepository.save.mockRejectedValue(new Error('database unavailable'))

    await expect(service.submitKyc(userId, dto, files)).rejects.toThrow(
      'database unavailable'
    )
    expect(media.remove).toHaveBeenCalledTimes(3)
  })
})

describe('KycService.readMedia', () => {
  const ownerId = '507f1f77bcf86cd799439011'
  const recordId = '507f1f77bcf86cd799439012'

  it('allows the owner to read their encrypted media', async () => {
    const { service, kycRepository, media } = createService()
    kycRepository.findOne.mockResolvedValue({
      _id: new ObjectId(recordId),
      userId: ownerId,
      frontCardUrl: `kyc-media:${ownerId}:front-card:123`,
    })

    await expect(
      service.readMedia(recordId, 'front-card', ownerId)
    ).resolves.toEqual({ buffer: Buffer.from('image'), mimetype: 'image/jpeg' })
    expect(media.read).toHaveBeenCalledWith(
      `kyc-media:${ownerId}:front-card:123`
    )
  })

  it('allows staff to read media owned by another user', async () => {
    const { service, kycRepository } = createService()
    kycRepository.findOne.mockResolvedValue({
      _id: new ObjectId(recordId),
      userId: ownerId,
      selfieUrl: `kyc-media:${ownerId}:selfie:123`,
    })

    await expect(
      service.readMedia(recordId, 'selfie', 'another-user', ['staff'])
    ).resolves.toMatchObject({ mimetype: 'image/jpeg' })
  })

  it('rejects a different unprivileged user', async () => {
    const { service, kycRepository, media } = createService()
    kycRepository.findOne.mockResolvedValue({
      _id: new ObjectId(recordId),
      userId: ownerId,
    })

    await expect(
      service.readMedia(recordId, 'front-card', 'another-user')
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(media.read).not.toHaveBeenCalled()
  })
})
