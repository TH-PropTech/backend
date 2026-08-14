import type { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { PriceBenchmarkService } from './price-benchmark.service'
import type { Apartment } from '../apartments/schemas/apartment.schema'

type ApartmentRepositoryMock = {
  find: jest.Mock<Promise<Apartment[]>, [unknown?]>
}

function createApartment(
  priceMonthly: number,
  overrides: Partial<Apartment> = {}
): Apartment {
  return {
    _id: new ObjectId(),
    title: 'Căn hộ kiểm thử',
    buildingId: null,
    buildingName: null,
    projectId: null,
    projectName: null,
    category: 'apartment',
    description: 'Căn hộ có dữ liệu benchmark',
    location: 'Quận 1',
    city: 'Hồ Chí Minh',
    district: 'Quận 1',
    ward: 'Bến Nghé',
    street: 'Nguyễn Huệ',
    address: '10 Nguyễn Huệ',
    priceMonthly,
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
    gallery: [],
    images360: [],
    vrUrl: '',
    amenities: [],
    status: 'available',
    isVerified: true,
    landlordId: 'landlord-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('PriceBenchmarkService', () => {
  let apartmentRepository: ApartmentRepositoryMock
  let service: PriceBenchmarkService

  beforeEach(() => {
    apartmentRepository = {
      find: jest.fn<Promise<Apartment[]>, [unknown?]>(),
    }
    service = new PriceBenchmarkService(
      apartmentRepository as unknown as Repository<Apartment>
    )
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns median, quartiles and fair classification for five comparable listings', async () => {
    apartmentRepository.find.mockResolvedValue(
      [8, 9, 10, 11, 12].map(value => createApartment(value * 1_000_000))
    )

    const result = await service.calculateBenchmark({
      district: 'Quận 1',
      bedrooms: 2,
      priceMonthly: 10_000_000,
    })

    expect(result).toEqual(
      expect.objectContaining({
        median: 10_000_000,
        p25: 9_000_000,
        p75: 11_000_000,
        sampleCount: 5,
        excludedOutliers: 0,
        confidence: 'low',
        classification: 'fair_range',
      })
    )
  })

  it('returns not_enough_data without fabricated statistics below five samples', async () => {
    apartmentRepository.find.mockResolvedValue(
      [8, 9, 10, 11].map(value => createApartment(value * 1_000_000))
    )

    const result = await service.calculateBenchmark({
      district: 'Quận 1',
      bedrooms: 2,
      priceMonthly: 10_000_000,
    })

    expect(result.classification).toBe('not_enough_data')
    expect(result.sampleCount).toBe(4)
    expect(result.median).toBeNull()
    expect(result.p25).toBeNull()
    expect(result.p75).toBeNull()
  })

  it.each([
    { priceMonthly: 8_000_000, expected: 'below_market' },
    { priceMonthly: 9_000_000, expected: 'fair_range' },
    { priceMonthly: 11_000_000, expected: 'fair_range' },
    { priceMonthly: 12_000_000, expected: 'above_market' },
  ] as const)(
    'classifies target price $priceMonthly as $expected',
    async ({ priceMonthly, expected }) => {
      apartmentRepository.find.mockResolvedValue(
        [8, 9, 10, 11, 12].map(value => createApartment(value * 1_000_000))
      )

      const result = await service.calculateBenchmark({
        district: 'Quận 1',
        bedrooms: 2,
        priceMonthly,
      })

      expect(result.classification).toBe(expected)
    }
  )

  it('excludes IQR outliers before returning the market range', async () => {
    apartmentRepository.find.mockResolvedValue(
      [8, 9, 10, 11, 12, 100].map(value => createApartment(value * 1_000_000))
    )

    const result = await service.calculateBenchmark({
      district: 'Quận 1',
      bedrooms: 2,
      priceMonthly: 10_000_000,
    })

    expect(result.excludedOutliers).toBe(1)
    expect(result.sampleCount).toBe(5)
    expect(result.range).toEqual({ min: 8_000_000, max: 12_000_000 })
  })

  it('queries only available listings with the requested base criteria', async () => {
    apartmentRepository.find.mockResolvedValue([])

    await service.calculateBenchmark({
      district: 'Quận 7',
      bedrooms: 3,
      priceMonthly: 20_000_000,
      furniture: 'Đầy đủ',
      area: 80,
    })

    expect(apartmentRepository.find).toHaveBeenCalledWith({
      where: {
        status: 'available',
        district: 'Quận 7',
        bedrooms: 3,
        furniture: 'Đầy đủ',
      },
      order: { updatedAt: 'DESC' },
    })
  })

  it('filters returned comparables to the requested area tolerance', async () => {
    apartmentRepository.find.mockResolvedValue([
      ...[8, 9, 10, 11, 12].map(value =>
        createApartment(value * 1_000_000, { area: 80 })
      ),
      createApartment(30_000_000, { area: 120 }),
    ])

    const result = await service.calculateBenchmark({
      district: 'Quận 1',
      bedrooms: 2,
      priceMonthly: 10_000_000,
      area: 80,
    })

    expect(result.sampleCount).toBe(5)
    expect(result.excludedOutliers).toBe(0)
  })

  it.each([
    { count: 5, expected: 'low' },
    { count: 10, expected: 'medium' },
    { count: 20, expected: 'high' },
  ] as const)(
    'returns $expected confidence for $count samples',
    async ({ count, expected }) => {
      apartmentRepository.find.mockResolvedValue(
        Array.from({ length: count }, (_, index) =>
          createApartment(10_000_000 + index * 10_000)
        )
      )

      const result = await service.calculateBenchmark({
        district: 'Quận 1',
        bedrooms: 2,
        priceMonthly: 10_000_000,
      })

      expect(result.confidence).toBe(expected)
    }
  )
})
