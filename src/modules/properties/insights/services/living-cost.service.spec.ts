import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { LivingCostService } from './living-cost.service'
import type { ApartmentAnalysis } from '../schemas/apartment-analysis.schema'

type AnalysisRow = ApartmentAnalysis & Record<string, unknown>

type ProfileRepositoryMock = {
  create: jest.Mock<AnalysisRow, [Partial<ApartmentAnalysis>]>
  find: jest.Mock<Promise<AnalysisRow[]>, [{ where?: unknown } & object]>
  findOne: jest.Mock<
    Promise<AnalysisRow | null>,
    [{ where?: unknown } & object]
  >
  remove: jest.Mock<Promise<AnalysisRow>, [AnalysisRow]>
  save: jest.Mock<Promise<AnalysisRow>, [AnalysisRow]>
}

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

function createProfile(
  overrides: Partial<ApartmentAnalysis> = {}
): AnalysisRow {
  return {
    _id: new ObjectId(),
    kind: 'living-cost',
    userId: 'tenant-1',
    name: 'Home budget',
    monthlyRent: 10_000_000,
    serviceFee: 0,
    parkingFee: 0,
    internetFee: 0,
    electricityEstimate: {
      type: 'estimated',
      low: 200_000,
      mid: 350_000,
      high: 600_000,
    },
    waterEstimate: {
      type: 'estimated',
      low: 60_000,
      mid: 100_000,
      high: 160_000,
    },
    commuteEstimate: {},
    oneTimeCosts: [],
    occupants: 1,
    totalEstimate: {
      type: 'estimated',
      low: 10_260_000,
      mid: 10_450_000,
      high: 10_760_000,
    },
    affordabilityStatus: 'unknown',
    confidenceLabel: 'medium',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/** Bản ghi kind 'condition' cùng collection: phải không bao giờ lọt vào hồ sơ chi phí. */
function createConditionRow(
  overrides: Partial<ApartmentAnalysis> = {}
): AnalysisRow {
  return {
    _id: new ObjectId(),
    kind: 'condition',
    userId: 'tenant-1',
    apartmentId: 'apartment-1',
    imageUrl: 'https://app.example.com/api/v1/condition-analyses/x/image',
    imageStorageKey: 'key.jpg',
    findings: [],
    overallCondition: 'good',
    checklist: [],
    model: 'm',
    isPrivate: true,
    createdAt: new Date(),
    ...overrides,
  } as AnalysisRow
}

describe('LivingCostService', () => {
  let store: AnalysisRow[]
  let repository: ProfileRepositoryMock
  let service: LivingCostService

  beforeEach(() => {
    store = []
    repository = {
      create: jest.fn(value => value as AnalysisRow),
      find: jest.fn(({ where }) =>
        Promise.resolve(
          store.filter(row =>
            matchesWhere(row, where as Record<string, unknown>)
          )
        )
      ),
      findOne: jest.fn(({ where }) =>
        Promise.resolve(
          store.find(row =>
            matchesWhere(row, where as Record<string, unknown>)
          ) ?? null
        )
      ),
      remove: jest.fn<Promise<AnalysisRow>, [AnalysisRow]>(value => {
        store = store.filter(row => row !== value)
        return Promise.resolve(value)
      }),
      save: jest.fn<Promise<AnalysisRow>, [AnalysisRow]>(value => {
        store.push(value)
        return Promise.resolve(value)
      }),
    }
    service = new LivingCostService(
      repository as unknown as Repository<ApartmentAnalysis>
    )
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns an itemized estimate and affordable status for a complete input', () => {
    const result = service.calculateCost({
      apartmentId: 'apartment-1',
      monthlyRent: 10_000_000,
      serviceFee: 500_000,
      parkingFee: 150_000,
      internetFee: 200_000,
      commuteEstimate: { mode: 'motorbike', monthlyFee: 300_000 },
      oneTimeCosts: [{ name: 'Deposit', amount: 20_000_000 }],
      occupants: 2,
      monthlyBudget: 15_000_000,
    })

    expect(result.totalEstimate).toEqual({
      type: 'estimated',
      low: 11_670_000,
      mid: 12_050_000,
      high: 12_670_000,
    })
    expect(result.affordabilityStatus).toBe('affordable')
    expect(result.confidenceLabel).toBe('high')
    expect(result.oneTimeCosts).toEqual([
      { name: 'Deposit', amount: 20_000_000 },
    ])
  })

  it.each([
    { budget: 12_000_000, expected: 'affordable' },
    { budget: 10_500_000, expected: 'tight' },
    { budget: 8_500_000, expected: 'over_budget' },
    { budget: undefined, expected: 'unknown' },
  ] as const)(
    'classifies affordability as $expected for budget $budget',
    ({ budget, expected }) => {
      const result = service.calculateCost({
        monthlyRent: 8_500_000,
        occupants: 1,
        ...(budget === undefined ? {} : { monthlyBudget: budget }),
      })

      expect(result.affordabilityStatus).toBe(expected)
    }
  )

  it('uses explicit zero defaults and medium confidence without an apartment', () => {
    const result = service.calculateCost({ monthlyRent: 0 })

    expect(result.serviceFee).toBe(0)
    expect(result.commuteEstimate).toEqual({})
    expect(result.occupants).toBe(1)
    expect(result.confidenceLabel).toBe('medium')
  })

  it('saves a profile with kind living-cost and returns it without kind', async () => {
    const saved = await service.saveProfile('tenant-1', {
      name: 'Nhà mới',
      monthlyRent: 8_000_000,
      apartmentId: 'apartment-1',
    })

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'living-cost', userId: 'tenant-1' })
    )
    expect(repository.save).toHaveBeenCalledTimes(1)
    expect(saved).not.toHaveProperty('kind')
    expect(saved.name).toBe('Nhà mới')
  })

  it('paginates only living-cost profiles owned by the current user', async () => {
    store.push(
      createProfile(),
      createProfile({ _id: new ObjectId(), name: 'Second' }),
      createProfile({ _id: new ObjectId(), name: 'Third' }),
      createConditionRow(),
      createConditionRow({ _id: new ObjectId() }),
      createProfile({ _id: new ObjectId(), userId: 'tenant-2' })
    )

    const result = await service.getMyProfiles('tenant-1', {
      page: 2,
      limit: 2,
    })

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind: 'living-cost', userId: 'tenant-1' },
      })
    )
    expect(result.total).toBe(3)
    expect(result.items).toHaveLength(1)
    expect(result.totalPages).toBe(2)
    expect(result.items.every(item => !('kind' in item))).toBe(true)
  })

  it('deletes an owned profile', async () => {
    const profile = createProfile()
    store.push(profile)

    await service.deleteProfile(profile._id.toString(), profile.userId)

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { _id: profile._id, kind: 'living-cost' },
    })
    expect(repository.remove).toHaveBeenCalledWith(profile)
  })

  it('rejects deletion of another user profile', async () => {
    const profile = createProfile({ userId: 'tenant-2' })
    store.push(profile)

    await expect(
      service.deleteProfile(profile._id.toString(), 'tenant-1')
    ).rejects.toThrow(ForbiddenException)
    expect(repository.remove).not.toHaveBeenCalled()
  })

  it('does not treat a condition analysis id as a living-cost profile', async () => {
    const condition = createConditionRow({ userId: 'tenant-1' })
    store.push(condition)

    await expect(
      service.deleteProfile(condition._id.toString(), 'tenant-1')
    ).rejects.toThrow(NotFoundException)
    expect(repository.remove).not.toHaveBeenCalled()
    expect(store).toHaveLength(1)
  })

  it('rejects an invalid profile identifier without leaking repository errors', async () => {
    await expect(
      service.deleteProfile('not-an-object-id', 'tenant-1')
    ).rejects.toThrow(NotFoundException)
  })
})
