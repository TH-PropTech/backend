import { ForbiddenException, NotFoundException } from '@nestjs/common'
import type { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import type { Repository } from 'typeorm'
import { PlatformFeesService } from './platform-fees.service'
import type {
  PlatformFeeScheduleRepository,
  PlatformFeeScheduleView,
} from '../utils/platform-fee-schedule.repository'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import type { Apartment } from '../../properties/schemas/apartment.schema'
import { ObjectId } from 'mongodb'
import type { Payment } from '../schemas/payment.schema'
import type { PlatformFeeScheduleRules } from '../utils/platform-fee.types'
import * as feeRulesValidator from '../utils/fee-rules.validator'

describe('PlatformFeesService.getEffectiveSchedule (PROP-399 governance source)', () => {
  const now = new Date('2026-10-02T00:00:00.000Z')
  function build(
    rows: Partial<PlatformFeeScheduleView>[]
  ): PlatformFeesService {
    const scheduleRepo = { find: jest.fn().mockResolvedValue(rows) }
    return new PlatformFeesService(
      scheduleRepo as unknown as PlatformFeeScheduleRepository,
      {} as unknown as ConfigAuditService,
      {} as unknown as Repository<Payment>,
      {} as unknown as Repository<Apartment>
    )
  }

  it('returns the published schedule with the latest effectiveFrom that has already started', async () => {
    const service = build([
      {
        scheduleId: 'old',
        version: 1,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        scheduleId: 'current',
        version: 2,
        effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        scheduleId: 'future',
        version: 3,
        effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
      },
    ])
    await expect(service.getEffectiveSchedule(now)).resolves.toMatchObject({
      scheduleId: 'current',
    })
  })

  it('returns null when no published schedule is in effect', async () => {
    await expect(build([]).getEffectiveSchedule(now)).resolves.toBeNull()
    await expect(
      build([
        { scheduleId: 'future', effectiveFrom: new Date('2027-01-01') },
        { scheduleId: 'none', effectiveFrom: null },
      ]).getEffectiveSchedule(now)
    ).resolves.toBeNull()
  })
})

describe('PlatformFeesService audit writes (characterization)', () => {
  it('appends an audit row for a saved draft and for an archive', async () => {
    const created: Record<string, unknown>[] = []
    const auditRepo = {
      create: jest.fn((v: Record<string, unknown>) => v),
      save: jest.fn((v: Record<string, unknown>) => {
        created.push(v)
        return Promise.resolve(v)
      }),
    }
    const scheduleRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: Record<string, unknown>) => v),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
    }
    const service = new PlatformFeesService(
      scheduleRepo as unknown as PlatformFeeScheduleRepository,
      new ConfigAuditService(auditRepo as unknown as Repository<ActivityLog>),
      {} as unknown as Repository<Payment>,
      {} as unknown as Repository<Apartment>
    )
    const rules = {
      transactionTypes: {},
    } as unknown as PlatformFeeScheduleRules
    jest.spyOn(feeRulesValidator, 'validateFeeRules').mockReturnValue([])

    await service.saveDraft(
      { scheduleId: 'fee-1', rules, reason: 'init' },
      'admin-1'
    )
    scheduleRepo.findOne.mockResolvedValue({
      scheduleId: 'fee-1',
      version: 1,
      contentHash: 'h',
    })
    await service.archive('fee-1', 1, 'admin-2', 'retire')

    expect(created).toHaveLength(2)
    expect(created[0]).toEqual(
      expect.objectContaining({
        kind: 'config-audit',
        scope: 'platform-fee',
        key: 'fee-1',
        version: 1,
        action: 'draft-saved',
        actorId: 'admin-1',
        reason: 'init',
        details: {
          changedFields: ['rules', 'legalReviewStatus', 'reviewReference'],
        },
        beforeHash: null,
      })
    )
    expect(created[1]).toEqual({
      kind: 'config-audit',
      scope: 'platform-fee',
      key: 'fee-1',
      version: 1,
      action: 'archived',
      actorId: 'admin-2',
      reason: 'retire',
      details: { changedFields: ['status'] },
      beforeHash: 'h',
      afterHash: 'h',
    })
  })
})

describe('PlatformFeesService landlord commission preview', () => {
  const rules: PlatformFeeScheduleRules = {
    landlordCommission: {
      tiers: [
        {
          minDurationMonths: 6,
          maxDurationMonths: 12,
          basis: 'MONTHS_OF_RENT',
          value: 1,
        },
      ],
      dueDaysAfterActivation: 10,
    },
    tenantServiceFee: { basis: 'FIXED', value: 200_000 },
    vatRatePercent: 10,
    pricesIncludeVat: false,
    roundingUnit: 1000,
    disclosure: { tenantText: 'tenant text', landlordText: 'landlord text' },
  }
  const schedule = {
    scheduleId: 's',
    version: 1,
    contentHash: 'h',
    effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
    rules,
  } as unknown as PlatformFeeScheduleView

  function build(
    rows: PlatformFeeScheduleView[],
    apartment: Partial<Apartment> | null = null
  ): PlatformFeesService {
    return new PlatformFeesService(
      {
        find: jest.fn().mockResolvedValue(rows),
      } as unknown as PlatformFeeScheduleRepository,
      {} as unknown as ConfigAuditService,
      {} as unknown as Repository<Payment>,
      {
        findOne: jest.fn().mockResolvedValue(apartment),
      } as unknown as Repository<Apartment>
    )
  }

  it('quotes landlord commission only, flags durations without a tier', async () => {
    const result = await build([schedule]).previewLandlordCommission([
      { durationMonths: 12, monthlyRent: 10_000_000 },
      { durationMonths: 3, monthlyRent: 10_000_000 },
    ])
    expect(result).toMatchObject({
      scheduleAvailable: true,
      dueDaysAfterActivation: 10,
      vatRatePercent: 10,
      pricesIncludeVat: false,
      landlordText: 'landlord text',
    })
    expect(result.packages[0]).toEqual({
      durationMonths: 12,
      monthlyRent: 10_000_000,
      applicable: true,
      amountBeforeVat: 10_000_000,
      vatAmount: 1_000_000,
      amount: 11_000_000,
    })
    expect(result.packages[1]).toEqual({
      durationMonths: 3,
      monthlyRent: 10_000_000,
      applicable: false,
      amountBeforeVat: null,
      vatAmount: null,
      amount: null,
    })
    expect(JSON.stringify(result)).not.toContain('tenant text')
  })

  it('reports no schedule', async () => {
    const result = await build([]).previewLandlordCommission([
      { durationMonths: 12, monthlyRent: 5_000_000 },
    ])
    expect(result.scheduleAvailable).toBe(false)
    expect(result.dueDaysAfterActivation).toBeNull()
    expect(result.packages).toEqual([
      {
        durationMonths: 12,
        monthlyRent: 5_000_000,
        applicable: false,
        amountBeforeVat: null,
        vatAmount: null,
        amount: null,
      },
    ])
  })

  describe('quoteForApartment', () => {
    const id = new ObjectId().toHexString()
    const apartment = {
      landlordId: 'landlord-1',
      priceMonthly: 8_000_000,
      rentalPackages: [
        { durationMonths: 12, monthlyRent: 9_000_000, status: 'active' },
        { durationMonths: 6, monthlyRent: 9_500_000, status: 'inactive' },
      ],
    } as unknown as Apartment

    it('lets the owning landlord see active packages only', async () => {
      const result = await build([schedule], apartment).quoteForApartment(id, {
        id: 'landlord-1',
        roles: ['landlord'],
      })
      expect(result.packages.map(p => p.durationMonths)).toEqual([12])
    })

    it('rejects another landlord and allows staff', async () => {
      const service = build([schedule], apartment)
      await expect(
        service.quoteForApartment(id, { id: 'other', roles: ['landlord'] })
      ).rejects.toThrow(ForbiddenException)
      await expect(
        service.quoteForApartment(id, { id: 'staff-1', roles: ['staff'] })
      ).resolves.toMatchObject({ scheduleAvailable: true })
    })

    it('404s when the apartment is missing', async () => {
      await expect(
        build([schedule], null).quoteForApartment(id, {
          id: 'x',
          roles: ['admin'],
        })
      ).rejects.toThrow(NotFoundException)
    })

    it('falls back to a 12-month package from priceMonthly', async () => {
      const result = await build([schedule], {
        landlordId: 'landlord-1',
        priceMonthly: 8_000_000,
      }).quoteForApartment(id, { id: 'landlord-1', roles: ['landlord'] })
      expect(result.packages).toMatchObject([
        { durationMonths: 12, monthlyRent: 8_000_000, applicable: true },
      ])
      const none = await build([schedule], {
        landlordId: 'landlord-1',
        priceMonthly: 0,
      }).quoteForApartment(id, { id: 'landlord-1', roles: ['landlord'] })
      expect(none.packages).toEqual([])
    })
  })
})
