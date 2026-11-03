/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- jest.Mock.calls và mock repo Mongo là any */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'

import type { KycMediaService } from './kyc-media.service'
import { UnprocessableEntityException } from '@nestjs/common'
import type { EkycClient } from '../../ekyc/services/ekyc-client.service'
import { KycService } from './kyc.service'

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

const FACE_OK = {
  liveness: true,
  spoofScore: 0.1,
  match: true,
  distance: 0.4,
  threshold: 0.85,
}

const USER_ID = '507f1f77bcf86cd799439011'
const RECORD_ID = '507f1f77bcf86cd799439012'

/** Hàng `users` thô (aggregate) có nhúng `kyc`, đúng hình KycService đọc. */
function userRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    _id: new ObjectId(USER_ID),
    email: 'a@example.com',
    phone: '0901234567',
    kycStatus: 'pending',
    kyc: {
      recordId: new ObjectId(RECORD_ID),
      idCardNumber: '079123456789',
      frontCardUrl: `kyc-media:${USER_ID}:front-card:1`,
      backCardUrl: `kyc-media:${USER_ID}:back-card:1`,
      selfieUrl: `kyc-media:${USER_ID}:selfie:1`,
      fullName: 'Nguyen Van A',
      status: 'pending',
      rejectedReason: null,
      verifiedAt: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date('2026-09-01T00:00:00Z'),
      ...overrides,
    },
  }
}

function aggregateReturns(rows: unknown[]): jest.Mock {
  return jest
    .fn()
    .mockReturnValue({ toArray: jest.fn().mockResolvedValue(rows) })
}

function createService(): {
  service: KycService
  userRepository: {
    aggregate: jest.Mock
    findOne: jest.Mock
    updateOne: jest.Mock
  }
  media: jest.Mocked<Pick<KycMediaService, 'store' | 'read' | 'remove'>>
  ekyc: { verifyFace: jest.Mock }
} {
  const userRepository = {
    aggregate: aggregateReturns([]),
    findOne: jest.fn().mockResolvedValue({
      _id: new ObjectId(USER_ID),
      kycStatus: 'not-started',
    }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
  }
  const media = {
    store: jest
      .fn()
      .mockImplementation((_userId: string, kind: string) =>
        Promise.resolve(`kyc-media:${USER_ID}:${kind}`)
      ),
    remove: jest.fn().mockResolvedValue(undefined),
    read: jest.fn().mockResolvedValue({
      buffer: Buffer.from('image'),
      mimetype: 'image/jpeg' as const,
    }),
  }
  const service = Object.create(KycService.prototype) as KycService
  Reflect.set(service, 'logger', { log: jest.fn(), warn: jest.fn() })
  Reflect.set(service, 'userRepository', userRepository)
  Reflect.set(service, 'kycMediaService', media as unknown as KycMediaService)
  const ekyc = { verifyFace: jest.fn().mockResolvedValue(FACE_OK) }
  Reflect.set(service, 'ekycClient', ekyc as unknown as EkycClient)

  return { service, userRepository, media, ekyc }
}

function setOf(call: unknown[]): Record<string, unknown> {
  return (call[1] as { $set: Record<string, unknown> }).$set
}

describe('KycService.submitKyc', () => {
  const dto = {
    idCardNumber: '079123456789',
    fullName: 'Nguyen Van A',
  }
  const files = {
    frontCard: createImage('frontCard'),
    backCard: createImage('backCard'),
    selfie: createImage('selfie'),
  }

  it('nhúng hồ sơ vào user bằng updateOne nguyên tử, không save toàn User', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = aggregateReturns([])

    await service.submitKyc(USER_ID, dto, files)

    expect(userRepository.updateOne).toHaveBeenCalledTimes(1)
    const [filter, update] = userRepository.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown>; $unset: Record<string, unknown> },
    ]
    expect(filter).toEqual({ _id: new ObjectId(USER_ID) })
    expect(update.$set['kyc.frontCardUrl']).toBe(
      `kyc-media:${USER_ID}:front-card`
    )
    expect(update.$set['kyc.selfieUrl']).toBe(`kyc-media:${USER_ID}:selfie`)
    expect(update.$set['kyc.faceMatchResult']).toBe(true)
    expect(update.$set['kyc.livenessResult']).toBe(true)
    expect(update.$set['kyc.spoofScore']).toBe(0.1)
    expect(update.$set['kyc.status']).toBe('pending')
    expect(update.$set['kycStatus']).toBe('pending')
    expect(update.$unset).toEqual({ 'kyc.ocrMatchRate': '' })
    expect(userRepository.updateOne.mock.calls[0]?.[0]).not.toHaveProperty(
      'save'
    )
  })

  it('giữ recordId và createdAt của hồ sơ cũ khi nộp lại (không đổi id công khai)', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = aggregateReturns([userRow()])

    await service.submitKyc(USER_ID, dto, files)

    const set = setOf(userRepository.updateOne.mock.calls[0] as unknown[])
    expect(set['kyc.recordId']).toEqual(new ObjectId(RECORD_ID))
    expect(set['kyc.createdAt']).toEqual(new Date('2026-09-01T00:00:00Z'))
  })

  it('không đè các trường DTO không gửi lên (giữ giá trị cũ như hành vi save cũ)', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = aggregateReturns([userRow()])

    await service.submitKyc(USER_ID, { idCardNumber: '079123456789' }, files)

    const set = setOf(userRepository.updateOne.mock.calls[0] as unknown[])
    expect(set).not.toHaveProperty('kyc.fullName')
    expect(set).not.toHaveProperty('kyc.dateOfBirth')
  })

  it('xóa media vừa lưu nếu ghi DB thất bại', async () => {
    const { service, userRepository, media } = createService()
    userRepository.updateOne.mockRejectedValue(
      new Error('database unavailable')
    )

    await expect(service.submitKyc(USER_ID, dto, files)).rejects.toThrow(
      'database unavailable'
    )
    expect(media.remove).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['liveness fails', { ...FACE_OK, liveness: false, match: false }],
    ['face does not match', { ...FACE_OK, match: false }],
  ])('từ chối 422 và không lưu gì khi %s', async (_name, face) => {
    const { service, userRepository, media, ekyc } = createService()
    ekyc.verifyFace.mockResolvedValue(face)

    await expect(service.submitKyc(USER_ID, dto, files)).rejects.toBeInstanceOf(
      UnprocessableEntityException
    )
    expect(media.store).not.toHaveBeenCalled()
    expect(userRepository.updateOne).not.toHaveBeenCalled()
  })

  it('không lưu gì khi dịch vụ eKYC lỗi (fail closed)', async () => {
    const { service, userRepository, media, ekyc } = createService()
    ekyc.verifyFace.mockRejectedValue(new Error('upstream down'))

    await expect(service.submitKyc(USER_ID, dto, files)).rejects.toThrow(
      'upstream down'
    )
    expect(media.store).not.toHaveBeenCalled()
    expect(userRepository.updateOne).not.toHaveBeenCalled()
  })

  it('xác thực khuôn mặt bằng selfie và mặt trước thẻ của lần nộp này', async () => {
    const { service, ekyc } = createService()

    await service.submitKyc(USER_ID, dto, files)

    expect(ekyc.verifyFace).toHaveBeenCalledWith(files.selfie, files.frontCard)
  })

  it('từ chối khi tài khoản đã xác minh KYC', async () => {
    const { service, userRepository } = createService()
    userRepository.findOne.mockResolvedValue({
      _id: new ObjectId(USER_ID),
      kycStatus: 'verified',
    })

    await expect(service.submitKyc(USER_ID, dto, files)).rejects.toBeInstanceOf(
      BadRequestException
    )
    expect(userRepository.updateOne).not.toHaveBeenCalled()
  })
})

describe('KycService monitoring and review', () => {
  const userId = USER_ID

  it('lọc theo trạng thái và tìm kiếm trên users.kyc, sắp xếp theo kyc.createdAt, phân trang', async () => {
    const { service, userRepository } = createService()
    const row = userRow()
    userRepository.aggregate = jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          items: [row],
          total: [{ n: 1 }],
        },
      ]),
    })

    const result = await service.findAll({
      status: 'pending',
      search: 'nguyen',
      page: 1,
      limit: 20,
    })

    const pipeline = userRepository.aggregate.mock.calls[0]?.[0] as Array<
      Record<string, any>
    >
    const match = pipeline[0]?.['$match'] as Record<string, any>
    expect(match['kyc.status']).toBe('pending')
    expect(match.$or).toEqual([
      { 'kyc.fullName': { $regex: 'nguyen', $options: 'i' } },
      { 'kyc.idCardNumber': { $regex: 'nguyen' } },
    ])
    expect(pipeline.find(stage => '$sort' in stage)).toEqual({
      $sort: { 'kyc.createdAt': -1, _id: -1 },
    })
    expect(result.total).toBe(1)
    expect(result.totalPages).toBe(1)
    expect(result.items[0]?.fullName).toBe('Nguyen Van A')
    expect(result.items[0]?._id).toEqual(new ObjectId(RECORD_ID))
    expect(result.items[0]?.userId).toBe(userId)
    expect(result.items[0]?.user).toEqual({
      email: 'a@example.com',
      phone: '0901234567',
    })
  })

  it('không đưa ảnh (URL media riêng tư) vào danh sách', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([{ items: [userRow()], total: [{ n: 1 }] }]),
    })

    const result = await service.findAll({ page: 1, limit: 20 })

    const item = result.items[0]
    expect(item).not.toHaveProperty('frontCardUrl')
    expect(item).not.toHaveProperty('backCardUrl')
    expect(item).not.toHaveProperty('selfieUrl')
  })

  it('đếm pending, verified, rejected và tổng từ users.kyc', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = aggregateReturns([
      { _id: 'pending', count: 2 },
      { _id: 'verified', count: 1 },
      { _id: 'rejected', count: 1 },
    ])

    await expect(service.countByStatus()).resolves.toEqual({
      pending: 2,
      verified: 1,
      rejected: 1,
      total: 4,
    })
    const pipeline = userRepository.aggregate.mock.calls[0]?.[0] as Array<
      Record<string, any>
    >
    expect(pipeline[0]).toEqual({ $match: { kyc: { $type: 'object' } } })
  })

  it('duyệt hồ sơ: một updateOne nguyên tử cập nhật kyc và kycStatus của user', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = jest
      .fn()
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([userRow()]),
      })
      .mockReturnValueOnce({
        toArray: jest
          .fn()
          .mockResolvedValue([
            userRow({ status: 'verified', reviewedBy: 'staff-1' }),
          ]),
      })

    const result = await service.review(RECORD_ID, 'verified', 'staff-1')

    expect(userRepository.updateOne).toHaveBeenCalledWith(
      {
        _id: new ObjectId(USER_ID),
        'kyc.recordId': new ObjectId(RECORD_ID),
        'kyc.status': 'pending',
      },
      {
        $set: expect.objectContaining({
          'kyc.status': 'verified',
          'kyc.reviewedBy': 'staff-1',
          'kyc.rejectedReason': null,
          'kyc.verifiedAt': expect.any(Date),
          kycStatus: 'verified',
          kycRejectReason: null,
        }),
      }
    )
    expect(result.status).toBe('verified')
  })

  it('từ chối có lý do và đồng bộ lý do lên user', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = jest
      .fn()
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([userRow()]),
      })
      .mockReturnValueOnce({
        toArray: jest
          .fn()
          .mockResolvedValue([
            userRow({ status: 'rejected', rejectedReason: 'Ảnh CCCD bị lóa' }),
          ]),
      })

    const result = await service.review(
      RECORD_ID,
      'rejected',
      'staff-1',
      'Ảnh CCCD bị lóa'
    )

    expect(userRepository.updateOne).toHaveBeenCalledWith(expect.any(Object), {
      $set: expect.objectContaining({
        'kyc.status': 'rejected',
        'kyc.reviewedBy': 'staff-1',
        'kyc.rejectedReason': 'Ảnh CCCD bị lóa',
        'kyc.verifiedAt': null,
        kycStatus: 'rejected',
        kycRejectReason: 'Ảnh CCCD bị lóa',
      }),
    })
    expect(result.status).toBe('rejected')
  })

  it('yêu cầu lý do trước khi từ chối và không đọc/ghi gì', async () => {
    const { service, userRepository } = createService()

    await expect(
      service.review(RECORD_ID, 'rejected', 'staff-1')
    ).rejects.toThrow(BadRequestException)
    expect(userRepository.aggregate).not.toHaveBeenCalled()
    expect(userRepository.updateOne).not.toHaveBeenCalled()
  })

  it('không duyệt lại hồ sơ đã có quyết định', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = aggregateReturns([
      userRow({ status: 'verified' }),
    ])

    await expect(
      service.review(RECORD_ID, 'verified', 'staff-1')
    ).rejects.toThrow(
      'Hồ sơ KYC đã ở trạng thái "verified", không thể duyệt lại'
    )
    expect(userRepository.updateOne).not.toHaveBeenCalled()
  })

  it('duyệt hồ sơ chỉ khi còn pending: filter có kyc.status=pending', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = jest
      .fn()
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([userRow()]),
      })
      .mockReturnValueOnce({
        toArray: jest
          .fn()
          .mockResolvedValue([
            userRow({ status: 'verified', reviewedBy: 'staff-1' }),
          ]),
      })

    await service.review(RECORD_ID, 'verified', 'staff-1')

    expect(userRepository.updateOne).toHaveBeenCalledWith(
      {
        _id: new ObjectId(USER_ID),
        'kyc.recordId': new ObjectId(RECORD_ID),
        'kyc.status': 'pending',
      },
      expect.any(Object)
    )
  })

  it('nếu staff khác đã quyết định trước (matchedCount=0) thì báo trạng thái hiện tại, không ghi đè', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = jest
      .fn()
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([userRow()]),
      })
      .mockReturnValueOnce({
        toArray: jest
          .fn()
          .mockResolvedValue([
            userRow({ status: 'rejected', rejectedReason: 'Ảnh mờ' }),
          ]),
      })
    userRepository.updateOne = jest.fn().mockResolvedValue({ matchedCount: 0 })

    await expect(
      service.review(RECORD_ID, 'verified', 'staff-2')
    ).rejects.toThrow(
      new BadRequestException(
        'Hồ sơ KYC đã ở trạng thái "rejected", không thể duyệt lại'
      )
    )
    expect(userRepository.updateOne).toHaveBeenCalledTimes(1)
  })

  it('matchedCount=0 và hồ sơ đã mất thì báo không tìm thấy', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = jest
      .fn()
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([userRow()]),
      })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) })
    userRepository.updateOne = jest.fn().mockResolvedValue({ matchedCount: 0 })

    await expect(
      service.review(RECORD_ID, 'verified', 'staff-2')
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('báo lỗi khi không tìm thấy hồ sơ theo id công khai', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = aggregateReturns([])

    await expect(service.findOne(RECORD_ID)).rejects.toBeInstanceOf(
      NotFoundException
    )
  })
})

describe('KycService.readMedia', () => {
  const ownerId = USER_ID
  const recordId = RECORD_ID

  it('cho chủ hồ sơ đọc ảnh của chính mình', async () => {
    const { service, userRepository, media } = createService()
    userRepository.aggregate = aggregateReturns([userRow()])

    await expect(
      service.readMedia(recordId, 'front-card', ownerId)
    ).resolves.toEqual({ buffer: Buffer.from('image'), mimetype: 'image/jpeg' })
    expect(media.read).toHaveBeenCalledWith(`kyc-media:${ownerId}:front-card:1`)
  })

  it('cho staff đọc ảnh của người khác', async () => {
    const { service, userRepository } = createService()
    userRepository.aggregate = aggregateReturns([userRow()])

    await expect(
      service.readMedia(recordId, 'selfie', 'another-user', ['staff'])
    ).resolves.toMatchObject({ mimetype: 'image/jpeg' })
  })

  it('từ chối người dùng không có quyền', async () => {
    const { service, userRepository, media } = createService()
    userRepository.aggregate = aggregateReturns([userRow()])

    await expect(
      service.readMedia(recordId, 'front-card', 'another-user')
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(media.read).not.toHaveBeenCalled()
  })

  it('trả 404 (không phải 500) khi hồ sơ cũ chưa có selfie', async () => {
    const { service, userRepository, media } = createService()
    userRepository.aggregate = aggregateReturns([userRow({ selfieUrl: '' })])

    await expect(
      service.readMedia(recordId, 'selfie', ownerId)
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(media.read).not.toHaveBeenCalled()
  })
})
