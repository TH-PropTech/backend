import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { ListingFreshnessService } from './listing-freshness.service'
import type { Apartment } from '../schemas/apartment.schema'
import type { ReviewCase } from '../schemas/review-case.schema'

type RepositoryMock<T> = {
  create: jest.Mock<T, [Partial<T>]>
  find: jest.Mock<Promise<T[]>, [unknown?]>
  findOne: jest.Mock<Promise<T | null>, [unknown?]>
  save: jest.Mock<Promise<T>, [T]>
}

/** Khớp `where` đơn giản như Mongo: mọi khóa phải bằng nhau (ObjectId so theo equals). */
function matchesWhere(
  row: object,
  where: Record<string, unknown> = {}
): boolean {
  const record = row as Record<string, unknown>
  return Object.entries(where).every(([key, expected]) => {
    const actual = record[key]
    if (expected instanceof ObjectId && actual instanceof ObjectId) {
      return actual.equals(expected)
    }
    return actual === expected
  })
}

function createApartment(overrides: Partial<Apartment> = {}): Apartment {
  return {
    _id: new ObjectId(),
    title: 'Căn hộ mẫu',
    projectId: null,
    projectName: null,
    category: 'apartment',
    description: 'Căn hộ đầy đủ tiện nghi gần trung tâm thành phố',
    location: '10 Nguyễn Huệ',
    city: 'Hồ Chí Minh',
    district: 'Quận 1',
    ward: 'Bến Nghé',
    street: 'Nguyễn Huệ',
    address: '10 Nguyễn Huệ, Bến Nghé, Quận 1',
    priceMonthly: 15_000_000,
    area: 60,
    bedrooms: 2,
    bathrooms: 2,
    direction: 'Đông',
    balconyDirection: 'Nam',
    furniture: 'Đầy đủ',
    moveInTime: 'Ngay',
    electricity: 'Nhà nước',
    water: 'Nhà nước',
    internet: 'Có sẵn',
    gallery: ['https://cdn.example.com/apartment.jpg'],
    images360: [],
    vrUrl: '',
    amenities: ['parking'],
    status: 'available',
    isVerified: true,
    landlordId: 'landlord-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }
}

function createReviewCase(overrides: Partial<ReviewCase> = {}): ReviewCase {
  return {
    _id: new ObjectId(),
    kind: 'listing',
    apartmentId: new ObjectId().toString(),
    type: 'duplicate_photo',
    confidence: 1,
    relatedApartmentId: new ObjectId().toString(),
    status: 'pending',
    evidence: 'Một URL ảnh trùng khớp',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/** Bản ghi của hàng đợi safety nằm chung collection review_cases (kind khác). */
function createSafetyRow(overrides: Partial<ReviewCase> = {}): ReviewCase {
  return {
    _id: new ObjectId(),
    kind: 'safety',
    reporterId: 'tenant-1',
    reporterRole: 'tenant',
    targetType: 'listing',
    targetId: new ObjectId().toString(),
    category: 'spam',
    description: 'Tin spam',
    evidenceUrls: [],
    riskLevel: 'low',
    status: 'pending',
    isTargetHidden: false,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('ListingFreshnessService', () => {
  let apartmentRepository: RepositoryMock<Apartment>
  let reviewCaseRepository: RepositoryMock<ReviewCase>
  let service: ListingFreshnessService

  beforeEach(() => {
    apartmentRepository = {
      create: jest.fn(value => value as Apartment),
      find: jest.fn<Promise<Apartment[]>, [unknown?]>(),
      findOne: jest.fn<Promise<Apartment | null>, [unknown?]>(),
      save: jest.fn<Promise<Apartment>, [Apartment]>(value =>
        Promise.resolve(value)
      ),
    }
    reviewCaseRepository = {
      create: jest.fn(value => value as ReviewCase),
      find: jest.fn<Promise<ReviewCase[]>, [unknown?]>(),
      findOne: jest.fn<Promise<ReviewCase | null>, [unknown?]>(),
      save: jest.fn<Promise<ReviewCase>, [ReviewCase]>(value =>
        Promise.resolve(value)
      ),
    }
    service = new ListingFreshnessService(
      apartmentRepository as unknown as Repository<Apartment>,
      reviewCaseRepository as unknown as Repository<ReviewCase>
    )
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it.each([
    { ageDays: 30, expected: 'fresh', needsConfirmation: false },
    { ageDays: 31, expected: 'needs_confirmation', needsConfirmation: true },
    { ageDays: 60, expected: 'needs_confirmation', needsConfirmation: true },
    { ageDays: 61, expected: 'stale', needsConfirmation: true },
  ] as const)(
    'classifies a listing aged $ageDays days as $expected',
    async ({ ageDays, expected, needsConfirmation }) => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-11T00:00:00.000Z'))
      const apartment = createApartment({
        updatedAt: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000),
      })
      apartmentRepository.findOne.mockResolvedValue(apartment)

      const result = await service.checkFreshness(apartment._id.toString())

      expect(result.status).toBe(expected)
      expect(result.needsConfirmation).toBe(needsConfirmation)
      expect(result.daysSinceUpdate).toBe(ageDays)
    }
  )

  it('lets the owner confirm a listing without changing its status', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-11T00:00:00.000Z'))
    const apartment = createApartment({
      status: 'available',
      updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    })
    apartmentRepository.findOne.mockResolvedValue(apartment)

    const result = await service.confirmListing(
      apartment._id.toString(),
      apartment.landlordId
    )

    expect(apartmentRepository.save).toHaveBeenCalledWith(apartment)
    expect(apartment.status).toBe('available')
    expect(apartment.updatedAt).toEqual(new Date('2026-08-11T00:00:00.000Z'))
    expect(result.status).toBe('fresh')
  })

  it('rejects confirmation by a non-owner', async () => {
    const apartment = createApartment({ landlordId: 'landlord-2' })
    apartmentRepository.findOne.mockResolvedValue(apartment)

    await expect(
      service.confirmListing(apartment._id.toString(), 'landlord-1')
    ).rejects.toThrow(ForbiddenException)
    expect(apartmentRepository.save).not.toHaveBeenCalled()
  })

  it('creates one pending duplicate-photo review case without mutating listings', async () => {
    const target = createApartment()
    const candidate = createApartment({
      _id: new ObjectId(),
      title: 'Căn hộ khác',
      description: 'Nội dung hoàn toàn khác để cô lập tín hiệu ảnh',
      location: '20 Lê Lợi',
      address: '20 Lê Lợi, Quận 3',
      street: 'Lê Lợi',
      gallery: [...target.gallery],
    })
    apartmentRepository.findOne.mockResolvedValue(target)
    apartmentRepository.find.mockResolvedValue([target, candidate])
    reviewCaseRepository.findOne.mockResolvedValue(null)

    const result = await service.detectDuplicates(target._id.toString())

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(
      expect.objectContaining({
        apartmentId: target._id.toString(),
        relatedApartmentId: candidate._id.toString(),
        type: 'duplicate_photo',
        confidence: 1,
        status: 'pending',
      })
    )
    // hình trả về giữ như cũ: không lộ kind
    expect(result[0]).not.toHaveProperty('kind')
    expect(reviewCaseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'listing' })
    )
    // chống trùng luôn lọc theo kind
    const [dedupQuery] = reviewCaseRepository.findOne.mock.calls[0] as [
      { where: Record<string, unknown> },
    ]
    expect(dedupQuery.where).toEqual({
      kind: 'listing',
      apartmentId: target._id.toString(),
      relatedApartmentId: candidate._id.toString(),
      type: 'duplicate_photo',
      status: 'pending',
    })
    expect(apartmentRepository.save).not.toHaveBeenCalled()
  })

  it('does not duplicate an existing pending review case', async () => {
    const target = createApartment()
    const candidate = createApartment({
      _id: new ObjectId(),
      description: 'Nội dung khác',
      location: '20 Lê Lợi',
      address: '20 Lê Lợi, Quận 3',
      street: 'Lê Lợi',
    })
    const existingCase = createReviewCase({
      apartmentId: target._id.toString(),
      relatedApartmentId: candidate._id.toString(),
    })
    apartmentRepository.findOne.mockResolvedValue(target)
    apartmentRepository.find.mockResolvedValue([target, candidate])
    reviewCaseRepository.findOne.mockResolvedValue(existingCase)

    const result = await service.detectDuplicates(target._id.toString())

    expect(result).toEqual([
      expect.objectContaining({
        _id: existingCase._id,
        apartmentId: existingCase.apartmentId,
        relatedApartmentId: existingCase.relatedApartmentId,
        type: existingCase.type,
        status: 'pending',
      }),
    ])
    expect(result[0]).not.toHaveProperty('kind')
    expect(reviewCaseRepository.save).not.toHaveBeenCalled()
  })

  it('records reviewer identity when a pending case is confirmed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-11T00:00:00.000Z'))
    const reviewCase = createReviewCase()
    reviewCaseRepository.findOne.mockResolvedValue(reviewCase)

    const result = await service.reviewCase(
      reviewCase._id.toString(),
      'staff-1',
      'confirmed'
    )

    const [reviewQuery] = reviewCaseRepository.findOne.mock.calls[0] as [
      { where: Record<string, unknown> },
    ]
    expect(reviewQuery.where).toEqual({
      _id: reviewCase._id,
      kind: 'listing',
    })
    expect(result.status).toBe('confirmed')
    expect(result.reviewedBy).toBe('staff-1')
    expect(result.reviewedAt).toEqual(new Date('2026-08-11T00:00:00.000Z'))
    expect(result).not.toHaveProperty('kind')
  })

  it('rejects a second review of an already processed case', async () => {
    const reviewCase = createReviewCase({ status: 'dismissed' })
    reviewCaseRepository.findOne.mockResolvedValue(reviewCase)

    await expect(
      service.reviewCase(reviewCase._id.toString(), 'staff-1', 'confirmed')
    ).rejects.toThrow('Review case đã được xử lý')
    expect(reviewCaseRepository.save).not.toHaveBeenCalled()
  })

  it('paginates the staff review queue', async () => {
    reviewCaseRepository.find.mockResolvedValue(
      Array.from({ length: 12 }, () => createReviewCase())
    )

    const result = await service.getReviewQueue({ page: 2, limit: 5 })

    expect(result.items).toHaveLength(5)
    expect(result.total).toBe(12)
    expect(result.totalPages).toBe(3)
    expect(reviewCaseRepository.find).toHaveBeenCalledWith({
      where: { kind: 'listing' },
      order: { createdAt: 'DESC' },
    })
  })

  it('keeps safety reports out of the listing queue when both share the collection', async () => {
    const rows: ReviewCase[] = [
      createReviewCase({ type: 'stale', status: 'pending' }),
      createSafetyRow({ status: 'pending' }),
      createReviewCase({ type: 'duplicate_photo', status: 'confirmed' }),
      createSafetyRow({ status: 'resolved' }),
    ]
    reviewCaseRepository.find.mockImplementation(options => {
      const where = (options as { where?: Record<string, unknown> } | undefined)
        ?.where
      return Promise.resolve(rows.filter(row => matchesWhere(row, where)))
    })

    const all = await service.getReviewQueue({ page: 1, limit: 20 })
    expect(all.total).toBe(2)
    for (const item of all.items) expect(item).not.toHaveProperty('kind')
    expect(all.items.map(item => item.type).sort()).toEqual([
      'duplicate_photo',
      'stale',
    ])

    const pendingStale = await service.getReviewQueue({
      page: 1,
      limit: 20,
      type: 'stale',
      status: 'pending',
    })
    expect(pendingStale.total).toBe(1)
  })

  it('does not treat a safety row as an existing listing case during detection', async () => {
    const target = createApartment()
    const candidate = createApartment({
      _id: new ObjectId(),
      description: 'Nội dung khác',
      location: '20 Lê Lợi',
      address: '20 Lê Lợi, Quận 3',
      street: 'Lê Lợi',
      gallery: [...target.gallery],
    })
    const safetyRow = createSafetyRow({
      apartmentId: target._id.toString(),
      relatedApartmentId: candidate._id.toString(),
      type: 'duplicate_photo',
      status: 'pending',
    })
    const rows: ReviewCase[] = [safetyRow]
    apartmentRepository.findOne.mockResolvedValue(target)
    apartmentRepository.find.mockResolvedValue([target, candidate])
    reviewCaseRepository.findOne.mockImplementation(options => {
      const where = (options as { where?: Record<string, unknown> }).where
      return Promise.resolve(rows.find(row => matchesWhere(row, where)) ?? null)
    })

    const result = await service.detectDuplicates(target._id.toString())

    expect(result).toHaveLength(1)
    expect(result[0]?._id).not.toEqual(safetyRow._id)
    expect(reviewCaseRepository.create).toHaveBeenCalledTimes(1)
  })

  it('returns not found for an invalid apartment identifier', async () => {
    await expect(service.checkFreshness('invalid-id')).rejects.toThrow(
      NotFoundException
    )
    expect(apartmentRepository.findOne).not.toHaveBeenCalled()
  })
})
