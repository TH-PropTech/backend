import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { ApartmentsService } from '../../services/apartments.service'
import { ConditionAnalysisService } from './condition-analysis.service'
import { GroqVisionService } from './groq-vision.service'
import type { ApartmentAnalysis } from '../schemas/apartment-analysis.schema'

type AnalysisRow = ApartmentAnalysis & Record<string, unknown>

/** Khớp `where` kiểu TypeORM (bằng nhau theo trường; ObjectId so theo giá trị). */
function matchesWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown> = {}
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (expected instanceof ObjectId) {
      return actual instanceof ObjectId && actual.equals(expected)
    }
    return actual === expected
  })
}

function createConditionRow(
  overrides: Partial<ApartmentAnalysis> = {}
): AnalysisRow {
  return {
    _id: new ObjectId(),
    kind: 'condition',
    userId: 'user-1',
    apartmentId: 'apartment-1',
    imageUrl: 'https://app.example.com/api/v1/condition-analyses/x/image',
    imageStorageKey: 'key.jpg',
    findings: [],
    overallCondition: 'good',
    checklist: [],
    model: 'test-model',
    isPrivate: true,
    createdAt: new Date(),
    ...overrides,
  } as AnalysisRow
}

/** Bản ghi kind 'living-cost' cùng collection: không được lọt vào phân tích ảnh. */
function createLivingCostRow(
  overrides: Partial<ApartmentAnalysis> = {}
): AnalysisRow {
  return {
    _id: new ObjectId(),
    kind: 'living-cost',
    userId: 'user-1',
    name: 'Hồ sơ',
    monthlyRent: 1,
    createdAt: new Date(),
    ...overrides,
  } as AnalysisRow
}

describe('ConditionAnalysisService', () => {
  const apartmentId = new ObjectId().toString()
  let store: AnalysisRow[]
  const repository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  }
  const groqVisionService = { analyzeCondition: jest.fn() }
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('https://app.example.com'),
  }
  const apartmentsService = { findOne: jest.fn() }

  let service: ConditionAnalysisService

  beforeEach(() => {
    jest.clearAllMocks()
    store = []
    repository.find.mockImplementation(({ where }) =>
      Promise.resolve(
        store.filter(row => matchesWhere(row, where as Record<string, unknown>))
      )
    )
    repository.findOne.mockImplementation(({ where }) =>
      Promise.resolve(
        store.find(row =>
          matchesWhere(row, where as Record<string, unknown>)
        ) ?? null
      )
    )
    service = new ConditionAnalysisService(
      repository as unknown as Repository<ApartmentAnalysis>,
      groqVisionService as unknown as GroqVisionService,
      configService as unknown as ConfigService,
      apartmentsService as unknown as ApartmentsService
    )
  })

  it('stores a private analysis only after apartment and provider success', async () => {
    const result = {
      findings: [],
      overallCondition: 'good' as const,
      checklist: [],
      model: 'test-model',
    }
    apartmentsService.findOne.mockResolvedValue({
      _id: new ObjectId(apartmentId),
    })
    groqVisionService.analyzeCondition.mockResolvedValue(result)
    repository.create.mockImplementation((value: unknown) => value)
    repository.save.mockImplementation((value: unknown) =>
      Promise.resolve(value)
    )

    const saved = await service.analyze('user-1', {
      apartmentId,
      imageStorageKey: 'private-key',
      image: Buffer.from('image'),
      mimeType: 'image/jpeg',
    })

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'condition' })
    )
    expect(saved.userId).toBe('user-1')
    expect(saved.isPrivate).toBe(true)
    expect(saved.imageUrl).toContain('/condition-analyses/')
    expect(saved).not.toHaveProperty('kind')
    expect(repository.save).toHaveBeenCalledTimes(1)
  })

  it('does not persist when the provider fails', async () => {
    apartmentsService.findOne.mockResolvedValue({
      _id: new ObjectId(apartmentId),
    })
    groqVisionService.analyzeCondition.mockRejectedValue(
      new Error('provider down')
    )

    await expect(
      service.analyze('user-1', {
        apartmentId,
        imageStorageKey: 'private-key',
        image: Buffer.from('image'),
        mimeType: 'image/jpeg',
      })
    ).rejects.toThrow('provider down')
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('lists only condition analyses of the current user and optional apartment scope', async () => {
    store.push(
      createConditionRow({ apartmentId }),
      createConditionRow({ apartmentId: 'other-apartment' }),
      createConditionRow({ userId: 'user-2', apartmentId }),
      createLivingCostRow({ apartmentId })
    )

    const scoped = await service.listMine('user-1', apartmentId)

    expect(repository.find).toHaveBeenCalledWith({
      where: { kind: 'condition', userId: 'user-1', apartmentId },
      order: { createdAt: 'DESC' },
    })
    expect(scoped).toHaveLength(1)
    expect(scoped[0]).not.toHaveProperty('kind')

    const all = await service.listMine('user-1')
    expect(repository.find).toHaveBeenLastCalledWith({
      where: { kind: 'condition', userId: 'user-1' },
      order: { createdAt: 'DESC' },
    })
    expect(all).toHaveLength(2)
  })

  it('rejects invalid, missing, and foreign analysis identifiers', async () => {
    await expect(service.getMine('bad-id', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException
    )

    const missingId = new ObjectId()
    await expect(
      service.getMine(missingId.toString(), 'user-1')
    ).rejects.toBeInstanceOf(NotFoundException)

    const foreign = createConditionRow({ userId: 'user-2' })
    store.push(foreign)
    await expect(
      service.getMine(foreign._id.toString(), 'user-1')
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('does not return a living-cost profile id as a condition analysis', async () => {
    const living = createLivingCostRow()
    store.push(living)

    await expect(
      service.getMine(living._id.toString(), 'user-1')
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { _id: living._id, kind: 'condition' },
    })
  })

  it('returns an owned analysis without kind', async () => {
    const row = createConditionRow()
    store.push(row)

    const analysis = await service.getMine(row._id.toString(), 'user-1')

    expect(analysis._id).toEqual(row._id)
    expect(analysis).not.toHaveProperty('kind')
    expect(analysis.imageStorageKey).toBe('key.jpg')
  })
})
