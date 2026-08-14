import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { ListingFreshnessService } from './listing-freshness.service'
import type { Apartment } from '../apartments/schemas/apartment.schema'
import type { ListingReviewCase } from './schemas/listing-review-case.schema'

type RepositoryMock<T> = {
  create: jest.Mock<T, [Partial<T>]>
  find: jest.Mock<Promise<T[]>, [unknown?]>
  findOne: jest.Mock<Promise<T | null>, [unknown?]>
  save: jest.Mock<Promise<T>, [T]>
}

function createApartment(overrides: Partial<Apartment> = {}): Apartment {
  return {
    _id: new ObjectId(),
    title: 'Căn hộ mẫu',
    buildingId: null,
    buildingName: null,
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

function createReviewCase(
  overrides: Partial<ListingReviewCase> = {}
): ListingReviewCase {
  return {
    _id: new ObjectId(),
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

describe('ListingFreshnessService', () => {
  let apartmentRepository: RepositoryMock<Apartment>
  let reviewCaseRepository: RepositoryMock<ListingReviewCase>
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
      create: jest.fn(value => value as ListingReviewCase),
      find: jest.fn<Promise<ListingReviewCase[]>, [unknown?]>(),
      findOne: jest.fn<Promise<ListingReviewCase | null>, [unknown?]>(),
      save: jest.fn<Promise<ListingReviewCase>, [ListingReviewCase]>(value =>
        Promise.resolve(value)
      ),
    }
    service = new ListingFreshnessService(
      apartmentRepository as unknown as Repository<Apartment>,
      reviewCaseRepository as unknown as Repository<ListingReviewCase>
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

    expect(result).toContain(existingCase)
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

    expect(result.status).toBe('confirmed')
    expect(result.reviewedBy).toBe('staff-1')
    expect(result.reviewedAt).toEqual(new Date('2026-08-11T00:00:00.000Z'))
  })

  it('paginates the staff review queue', async () => {
    reviewCaseRepository.find.mockResolvedValue(
      Array.from({ length: 12 }, () => createReviewCase())
    )

    const result = await service.getReviewQueue({ page: 2, limit: 5 })

    expect(result.items).toHaveLength(5)
    expect(result.total).toBe(12)
    expect(result.totalPages).toBe(3)
  })

  it('returns not found for an invalid apartment identifier', async () => {
    await expect(service.checkFreshness('invalid-id')).rejects.toThrow(
      NotFoundException
    )
    expect(apartmentRepository.findOne).not.toHaveBeenCalled()
  })
})
