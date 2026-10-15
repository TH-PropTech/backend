import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { ApartmentsService } from '../../services/apartments.service'
import { LocationRiskService } from './location-risk.service'
import type { DistrictData } from '../schemas/district-data.schema'

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
      rows.push(value)
      return Promise.resolve(value)
    }),
    remove: jest.fn(() => Promise.resolve()),
    find: jest.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(rows.filter(r => matches(r, options?.where)))
    ),
    findOne: jest.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(rows.find(r => matches(r, options?.where)) ?? null)
    ),
  }
}

describe('LocationRiskService', () => {
  const apartmentId = new ObjectId().toString()
  const repository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  }
  const apartmentsService = { findOne: jest.fn() }
  let service: LocationRiskService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new LocationRiskService(
      repository as unknown as Repository<DistrictData>,
      apartmentsService as unknown as ApartmentsService
    )
  })

  it('calculates a weighted score from sourced layers', async () => {
    apartmentsService.findOne.mockResolvedValue({ district: 'District 1' })
    repository.find.mockResolvedValue([
      { kind: 'risk-layer', layerType: 'flood', severity: 80 },
      { kind: 'risk-layer', layerType: 'traffic', severity: 20 },
    ])

    const result = await service.getRiskScore(apartmentId, {
      flood: 2,
      traffic: 1,
    })

    expect(repository.find).toHaveBeenCalledWith({
      where: { kind: 'risk-layer', district: 'District 1' },
      order: { timestamp: 'DESC' },
    })
    expect(result).toMatchObject({
      status: 'available',
      district: 'District 1',
      score: 60,
    })
  })

  it('returns explicit insufficient data when all layers are excluded', async () => {
    apartmentsService.findOne.mockResolvedValue({ district: 'District 1' })
    repository.find.mockResolvedValue([
      { kind: 'risk-layer', layerType: 'flood', severity: 80 },
    ])

    await expect(
      service.getRiskScore(apartmentId, { flood: 0 })
    ).resolves.toMatchObject({ status: 'insufficient_data', score: null })
  })

  it('rejects invalid weights and invalid layer identifiers', async () => {
    await expect(
      service.getRiskScore(apartmentId, { flood: -1 })
    ).rejects.toBeInstanceOf(BadRequestException)

    await expect(service.update('bad-id', {})).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('trims managed layer fields and preserves supplied source metadata', async () => {
    const layer = { district: ' D1 ', layerType: ' flood ', source: ' Source ' }
    repository.create.mockImplementation((value: unknown) => value)
    repository.save.mockImplementation((value: unknown) =>
      Promise.resolve(value)
    )

    const result = await service.create({
      ...layer,
      severity: 40,
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      confidence: 0.8,
    })

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'risk-layer' })
    )
    expect(result).toMatchObject({
      district: 'D1',
      layerType: 'flood',
      source: 'Source',
      severity: 40,
      confidence: 0.8,
    })
    expect(result).not.toHaveProperty('kind')
  })

  describe('with area-profile rows in the same collection', () => {
    const district = 'District 1'
    const areaRow: Row = {
      _id: new ObjectId(),
      kind: 'area-profile',
      district,
      city: 'Hồ Chí Minh',
      overview: 'Tổng quan',
      facilities: [],
      source: 'Khảo sát',
      disclaimer: 'tham khảo',
      lastSurveyedAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    const floodRow: Row = {
      _id: new ObjectId(),
      kind: 'risk-layer',
      district,
      layerType: 'flood',
      severity: 80,
      source: 'Nguồn',
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      confidence: 0.9,
      geoJson: null,
    }

    beforeEach(() => {
      const fake = fakeRepository([areaRow, floodRow])
      Object.assign(repository, {
        create: fake.create,
        save: fake.save,
        find: fake.find,
        findOne: fake.findOne,
      })
    })

    it('scores only risk-layer rows and ignores area profiles of the same district', async () => {
      apartmentsService.findOne.mockResolvedValue({ district })

      const result = await service.getRiskScore(apartmentId)

      expect(result.layers.map(layer => layer.layerType)).toEqual(['flood'])
      expect(result).toMatchObject({ status: 'available', score: 80 })
      expect(result.layers[0]).not.toHaveProperty('kind')
    })

    it('does not update or delete an area-profile row through the risk-layer API', async () => {
      await expect(
        service.update(String(areaRow._id), { source: 'X' })
      ).rejects.toBeInstanceOf(NotFoundException)
      await expect(service.delete(String(areaRow._id))).rejects.toBeInstanceOf(
        NotFoundException
      )
      expect(areaRow.source).toBe('Khảo sát')
    })
  })
})
