import { NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { ApartmentsService } from '../apartments/apartments.service'
import type { AreaProfile } from './schemas/area-profile.schema'
import { AreaProfilesService } from './area-profiles.service'

describe('AreaProfilesService', () => {
  const repository = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  }
  const apartments = { findOne: jest.fn() }
  const service = new AreaProfilesService(
    repository as unknown as Repository<AreaProfile>,
    apartments as unknown as ApartmentsService
  )

  beforeEach(() => jest.clearAllMocks())

  it('looks up a profile by exact district and city', async () => {
    const profile = { district: 'Quận 7', city: 'Hồ Chí Minh' } as AreaProfile
    repository.findOne.mockResolvedValue(profile)
    await expect(service.getByDistrict('Quận 7', 'Hồ Chí Minh')).resolves.toBe(
      profile
    )
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { district: 'Quận 7', city: 'Hồ Chí Minh' },
    })
  })

  it('gets the profile for an apartment location', async () => {
    apartments.findOne.mockResolvedValue({
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    })
    repository.findOne.mockResolvedValue({ _id: new ObjectId() })
    await expect(service.getForApartment('apartment-1')).resolves.toBeTruthy()
  })

  it('propagates apartment not found', async () => {
    apartments.findOne.mockRejectedValue(new NotFoundException())
    await expect(service.getForApartment('missing')).rejects.toThrow(
      NotFoundException
    )
  })

  it('sets default disclaimer and survey date when creating', async () => {
    repository.create.mockImplementation(
      (value: unknown): AreaProfile => value as AreaProfile
    )
    repository.save.mockImplementation(
      (value: unknown): Promise<AreaProfile> =>
        Promise.resolve(value as AreaProfile)
    )
    const result = await service.createProfile({
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
      overview: 'Khu vực có giao thông và tiện ích đầy đủ.',
      facilities: [],
      source: 'Khảo sát',
    })
    expect(result.disclaimer).toContain('tham khảo')
    expect(result.lastSurveyedAt).toBeInstanceOf(Date)
  })

  it('returns a paginated filtered list', async () => {
    repository.find.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        district: 'Quận 7',
        city: 'Hồ Chí Minh',
        overview: String(index),
      }))
    )
    const result = await service.getAllProfiles({
      district: 'Quận 7',
      page: 2,
      limit: 5,
    })
    expect(result.items).toHaveLength(5)
    expect(result.total).toBe(12)
  })

  it('rejects invalid IDs without querying the repository', async () => {
    await expect(service.updateProfile('bad-id', {})).rejects.toThrow(
      NotFoundException
    )
    expect(repository.findOne).not.toHaveBeenCalled()
  })
})
