import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { ApartmentsService } from '../../properties/services/apartments.service'
import { LocationRiskService } from './location-risk.service'
import { RiskLayerData } from '../schemas/risk-layer-data.schema'

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
      repository as unknown as Repository<RiskLayerData>,
      apartmentsService as unknown as ApartmentsService
    )
  })

  it('calculates a weighted score from sourced layers', async () => {
    apartmentsService.findOne.mockResolvedValue({ district: 'District 1' })
    repository.find.mockResolvedValue([
      { layerType: 'flood', severity: 80 },
      { layerType: 'traffic', severity: 20 },
    ])

    const result = await service.getRiskScore(apartmentId, {
      flood: 2,
      traffic: 1,
    })

    expect(result).toMatchObject({
      status: 'available',
      district: 'District 1',
      score: 60,
    })
  })

  it('returns explicit insufficient data when all layers are excluded', async () => {
    apartmentsService.findOne.mockResolvedValue({ district: 'District 1' })
    repository.find.mockResolvedValue([{ layerType: 'flood', severity: 80 }])

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

    expect(result).toMatchObject({
      district: 'D1',
      layerType: 'flood',
      source: 'Source',
      severity: 40,
      confidence: 0.8,
    })
  })
})
