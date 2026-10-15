import { NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { ApartmentsService } from '../../services/apartments.service'
import type { DistrictData } from '../schemas/district-data.schema'
import { AreaProfilesService } from './area-profiles.service'

type Row = Record<string, unknown> & { _id: ObjectId; kind?: string }

/** Repository giả có áp dụng `where` (so sánh bằng) để kiểm điều kiện `kind` thật sự. */
function fakeRepository(initial: Row[]): Record<string, jest.Mock> {
  const rows = [...initial]
  const matches = (row: Row, where: Record<string, unknown> = {}): boolean =>
    Object.entries(where).every(
      ([key, value]) => String(row[key]) === String(value)
    )
  return {
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: Row) => {
      if (!value._id) value._id = new ObjectId()
      const index = rows.findIndex(r => String(r._id) === String(value._id))
      if (index >= 0) rows[index] = value
      else rows.push(value)
      return Promise.resolve(value)
    }),
    remove: jest.fn((value: Row) => {
      const index = rows.findIndex(r => String(r._id) === String(value._id))
      rows.splice(index, 1)
      return Promise.resolve(value)
    }),
    find: jest.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(rows.filter(r => matches(r, options?.where)))
    ),
    findOne: jest.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(rows.find(r => matches(r, options?.where)) ?? null)
    ),
  }
}

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
    repository as unknown as Repository<DistrictData>,
    apartments as unknown as ApartmentsService
  )

  beforeEach(() => jest.clearAllMocks())

  it('looks up a profile by exact district and city', async () => {
    const profile = {
      kind: 'area-profile',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    } as DistrictData
    repository.findOne.mockResolvedValue(profile)
    await expect(
      service.getByDistrict('Quận 7', 'Hồ Chí Minh')
    ).resolves.toMatchObject({ district: 'Quận 7', city: 'Hồ Chí Minh' })
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { kind: 'area-profile', district: 'Quận 7', city: 'Hồ Chí Minh' },
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
      (value: unknown): DistrictData => value as DistrictData
    )
    repository.save.mockImplementation(
      (value: unknown): Promise<DistrictData> =>
        Promise.resolve(value as DistrictData)
    )
    const result = await service.createProfile({
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
      overview: 'Khu vực có giao thông và tiện ích đầy đủ.',
      facilities: [],
      source: 'Khảo sát',
    })
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'area-profile' })
    )
    expect(result.disclaimer).toContain('tham khảo')
    expect(result.lastSurveyedAt).toBeInstanceOf(Date)
    expect(result).not.toHaveProperty('kind')
  })

  it('returns a paginated filtered list', async () => {
    repository.find.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        kind: 'area-profile',
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
    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: 'area-profile' } })
    )
    expect(result.items).toHaveLength(5)
    expect(result.total).toBe(12)
  })

  it('rejects invalid IDs without querying the repository', async () => {
    await expect(service.updateProfile('bad-id', {})).rejects.toThrow(
      NotFoundException
    )
    expect(repository.findOne).not.toHaveBeenCalled()
  })

  describe('with risk-layer rows in the same collection', () => {
    const areaId = new ObjectId()
    const riskId = new ObjectId()
    const area: Row = {
      _id: areaId,
      kind: 'area-profile',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
      overview: 'Tổng quan khu vực đầy đủ tiện ích.',
      facilities: [],
      source: 'Khảo sát',
      disclaimer: 'tham khảo',
      lastSurveyedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    }
    const risk: Row = {
      _id: riskId,
      kind: 'risk-layer',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
      layerType: 'flood',
      severity: 80,
      source: 'Nguồn',
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      confidence: 0.9,
      geoJson: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    }

    function useMixedRepository(): void {
      const fake = fakeRepository([area, risk])
      Object.assign(repository, {
        create: fake.create,
        save: fake.save,
        remove: fake.remove,
        find: fake.find,
        findOne: fake.findOne,
      })
    }

    it('does not return a risk-layer row for an area-profile lookup by district', async () => {
      useMixedRepository()
      const found = await service.getByDistrict('Quận 7', 'Hồ Chí Minh')
      expect(String(found?._id)).toBe(String(areaId))
    })

    it('returns only area profiles in the public list', async () => {
      useMixedRepository()
      const result = await service.getAllProfiles({ page: 1, limit: 10 })
      expect(result.total).toBe(1)
      expect(result.items.map(item => String(item._id))).toEqual([
        String(areaId),
      ])
    })

    it('does not expose a risk-layer row through getById', async () => {
      useMixedRepository()
      await expect(service.getById(String(riskId))).rejects.toThrow(
        NotFoundException
      )
    })

    it('returns the area profile JSON shape without kind', async () => {
      useMixedRepository()
      const profile = await service.getById(String(areaId))
      expect(profile).not.toHaveProperty('kind')
      expect(profile).not.toHaveProperty('layerType')
      expect(profile).toMatchObject({
        district: 'Quận 7',
        city: 'Hồ Chí Minh',
        overview: 'Tổng quan khu vực đầy đủ tiện ích.',
        source: 'Khảo sát',
      })
    })

    it('does not update or delete a risk-layer row through the area-profile API', async () => {
      useMixedRepository()
      await expect(
        service.updateProfile(String(riskId), { source: 'X' })
      ).rejects.toThrow(NotFoundException)
      await expect(service.deleteProfile(String(riskId))).rejects.toThrow(
        NotFoundException
      )
      expect(risk.source).toBe('Nguồn')
    })
  })
})
