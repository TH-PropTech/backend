import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { LivingCostService } from './living-cost.service'
import type { LivingCostProfile } from '../schemas/living-cost-profile.schema'

type ProfileRepositoryMock = {
  create: jest.Mock<LivingCostProfile, [Partial<LivingCostProfile>]>
  find: jest.Mock<Promise<LivingCostProfile[]>, [unknown?]>
  findOne: jest.Mock<Promise<LivingCostProfile | null>, [unknown?]>
  remove: jest.Mock<Promise<LivingCostProfile>, [LivingCostProfile]>
  save: jest.Mock<Promise<LivingCostProfile>, [LivingCostProfile]>
}

function createProfile(
  overrides: Partial<LivingCostProfile> = {}
): LivingCostProfile {
  return {
    _id: new ObjectId(),
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

describe('LivingCostService', () => {
  let repository: ProfileRepositoryMock
  let service: LivingCostService

  beforeEach(() => {
    repository = {
      create: jest.fn(value => value as LivingCostProfile),
      find: jest.fn<Promise<LivingCostProfile[]>, [unknown?]>(),
      findOne: jest.fn<Promise<LivingCostProfile | null>, [unknown?]>(),
      remove: jest.fn<Promise<LivingCostProfile>, [LivingCostProfile]>(value =>
        Promise.resolve(value)
      ),
      save: jest.fn<Promise<LivingCostProfile>, [LivingCostProfile]>(value =>
        Promise.resolve(value)
      ),
    }
    service = new LivingCostService(
      repository as unknown as Repository<LivingCostProfile>
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

  it('paginates only profiles owned by the current user', async () => {
    repository.find.mockResolvedValue([
      createProfile(),
      createProfile({ _id: new ObjectId(), name: 'Second' }),
      createProfile({ _id: new ObjectId(), name: 'Third' }),
    ])

    const result = await service.getMyProfiles('tenant-1', {
      page: 2,
      limit: 2,
    })

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'tenant-1' } })
    )
    expect(result.items).toHaveLength(1)
    expect(result.totalPages).toBe(2)
  })

  it('deletes an owned profile', async () => {
    const profile = createProfile()
    repository.findOne.mockResolvedValue(profile)

    await service.deleteProfile(profile._id.toString(), profile.userId)

    expect(repository.remove).toHaveBeenCalledWith(profile)
  })

  it('rejects deletion of another user profile', async () => {
    const profile = createProfile({ userId: 'tenant-2' })
    repository.findOne.mockResolvedValue(profile)

    await expect(
      service.deleteProfile(profile._id.toString(), 'tenant-1')
    ).rejects.toThrow(ForbiddenException)
    expect(repository.remove).not.toHaveBeenCalled()
  })

  it('rejects an invalid profile identifier without leaking repository errors', async () => {
    await expect(
      service.deleteProfile('not-an-object-id', 'tenant-1')
    ).rejects.toThrow(NotFoundException)
  })
})
