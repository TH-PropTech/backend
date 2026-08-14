import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { Apartment } from './schemas/apartment.schema'
import { ListingQualityService } from './listing-quality.service'

function apartment(overrides: Partial<Apartment> = {}): Apartment {
  return {
    _id: new ObjectId(),
    landlordId: 'owner-1',
    title: 'A',
    location: 'L',
    address: 'A',
    furniture: 'full',
    moveInTime: 'now',
    electricity: 'e',
    water: 'w',
    internet: 'i',
    direction: 'north',
    balconyDirection: 'south',
    ward: 'w',
    district: 'd',
    street: 's',
    city: 'c',
    gallery: Array.from({ length: 8 }, (_, i) => String(i)),
    images360: ['360'],
    vrUrl: 'vr',
    description: 'x'.repeat(500),
    amenities: Array.from({ length: 7 }, (_, i) => String(i)),
    updatedAt: new Date(),
    ...overrides,
  } as Apartment
}

describe('ListingQualityService', () => {
  const repository = { findOne: jest.fn() }
  const service = new ListingQualityService(
    repository as unknown as Repository<Apartment>
  )
  beforeEach(() => jest.clearAllMocks())

  it('returns a capped perfect score with all breakdown categories', async () => {
    repository.findOne.mockResolvedValue(apartment())
    const result = await service.calculateQualityScore(
      '507f1f77bcf86cd799439011',
      'owner-1'
    )
    expect(result.score).toBe(100)
    expect(result.breakdown).toHaveLength(6)
  })

  it('returns a poor sparse listing with improvement actions', async () => {
    repository.findOne.mockResolvedValue(
      apartment({
        gallery: [],
        images360: [],
        vrUrl: '',
        description: '',
        amenities: [],
        title: '',
        location: '',
        address: '',
        furniture: '',
        moveInTime: '',
        electricity: '',
        water: '',
        internet: '',
        direction: '',
        balconyDirection: '',
        ward: '',
        district: '',
        street: '',
        city: '',
        updatedAt: new Date('2020-01-01'),
      })
    )
    const result = await service.calculateQualityScore(
      '507f1f77bcf86cd799439011',
      'owner-1'
    )
    expect(result.score).toBeLessThan(30)
    expect(result.checklist.map(item => item.id)).toContain('add_more_photos')
    expect(result.checklist.map(item => item.id)).toContain('refresh_listing')
  })

  it('rejects another landlord and missing apartments', async () => {
    repository.findOne.mockResolvedValueOnce(apartment())
    await expect(
      service.calculateQualityScore('507f1f77bcf86cd799439011', 'other')
    ).rejects.toThrow(ForbiddenException)
    repository.findOne.mockResolvedValueOnce(null)
    await expect(
      service.calculateQualityScore('507f1f77bcf86cd799439011', 'owner-1')
    ).rejects.toThrow(NotFoundException)
  })

  it.each([
    [85, 'excellent'],
    [70, 'good'],
    [50, 'fair'],
    [49, 'poor'],
  ] as const)('maps score %s to grade %s', (score, grade) => {
    expect(service.toGrade(score)).toBe(grade)
  })

  it('caps photo media points at 25 and applies freshness thresholds', async () => {
    repository.findOne.mockResolvedValue(
      apartment({ updatedAt: new Date(Date.now() - 31 * 86400000) })
    )
    const result = await service.calculateQualityScore(
      '507f1f77bcf86cd799439011',
      'owner-1'
    )
    expect(
      result.breakdown.find(item => item.category === 'photos')?.score
    ).toBe(25)
    expect(
      result.breakdown.find(item => item.category === 'freshness')?.score
    ).toBe(1)
    expect(
      result.breakdown.reduce((total, item) => total + item.score, 0)
    ).toBe(result.score)
  })
})
