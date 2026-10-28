import { ForbiddenException, ConflictException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { ApartmentsService } from './apartments.service'
import type { Apartment } from '../schemas/apartment.schema'
import type { UpdateRentalPackagesDto } from '../dto/create-apartment.dto'

describe('ApartmentsService.updateRentalPackages', () => {
  function createContext(): {
    service: ApartmentsService
    apartment: Apartment
    repository: { findOne: jest.Mock; save: jest.Mock }
  } {
    const apartment = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      landlordId: 'landlord-1',
      pricingMode: 'packages' as const,
      pricingRevision: 1,
      rentalPackages: [],
      priceMonthly: 10_000_000,
      status: 'available' as const,
      isVerified: true,
      approvedAt: new Date(),
      approvedBy: 'staff-1',
    } as unknown as Apartment
    const repository = {
      findOne: jest.fn().mockResolvedValue(apartment),
      save: jest.fn(
        (value: Apartment): Promise<Apartment> => Promise.resolve(value)
      ),
    }
    const service = Object.create(
      ApartmentsService.prototype
    ) as ApartmentsService
    Reflect.set(service, 'apartmentRepository', repository)
    return { service, apartment, repository }
  }

  const dto = {
    expectedRevision: 1,
    rentalPackages: [
      {
        packageId: 'pkg-3m',
        version: 2,
        durationMonths: 3 as const,
        monthlyRent: 12_000_000,
        depositPolicy: { type: 'MONTHS_OF_RENT' as const, months: 2 },
        settlementPolicy: {
          holdingDeposit: { type: 'FIXED_AMOUNT' as const, amount: 8_000_000 },
          allowedPaymentCycles: [1, 3] as Array<1 | 3 | 6>,
          defaultPaymentCycle: 3 as const,
          firstPaymentDueOffsetDays: 3,
        },
        status: 'active' as const,
      },
    ],
  } satisfies UpdateRentalPackagesDto

  it('allows the owner to update packages and sends the listing back for approval', async () => {
    const context = createContext()
    const result = await context.service.updateRentalPackages(
      context.apartment._id.toHexString(),
      dto,
      'landlord-1',
      false
    )

    expect(result.pricingRevision).toBe(2)
    expect(result.priceMonthly).toBe(12_000_000)
    expect(result.rentalPackages?.[0]).toMatchObject({
      resolvedHoldingDepositAmount: 8_000_000,
      resolvedSecurityTopUpAmount: 16_000_000,
    })
    expect(result.status).toBe('updating')
    expect(result.isVerified).toBe(false)
    expect(result.approvedBy).toBeNull()
    expect(context.repository.save).toHaveBeenCalledWith(context.apartment)
  })

  describe('prepaid rent', () => {
    const prepaidDto = (
      prepaidRent: unknown,
      durationMonths: 3 | 6 | 12 | 24 = 3
    ): UpdateRentalPackagesDto =>
      ({
        expectedRevision: 1,
        rentalPackages: [
          {
            packageId: 'pkg-p',
            version: 1,
            durationMonths,
            monthlyRent: 10_000_000,
            depositPolicy: { type: 'MONTHS_OF_RENT', months: 1 },
            status: 'active',
            prepaidRent,
          },
        ],
      }) as UpdateRentalPackagesDto

    it('stores the prepayment policy with its resolved months and amount', async () => {
      const context = createContext()
      const result = await context.service.updateRentalPackages(
        context.apartment._id.toHexString(),
        prepaidDto({ type: 'MONTHS', months: 2 }),
        'landlord-1',
        false
      )

      expect(result.rentalPackages?.[0]).toMatchObject({
        prepaidRent: { type: 'MONTHS', months: 2 },
        resolvedPrepaidRentMonths: 2,
        resolvedPrepaidRentAmount: 20_000_000,
      })
    })

    it('resolves deposit-only and full prepayment', async () => {
      const a = createContext()
      const noneResult = await a.service.updateRentalPackages(
        a.apartment._id.toHexString(),
        prepaidDto({ type: 'NONE' }),
        'landlord-1',
        false
      )
      expect(noneResult.rentalPackages?.[0]).toMatchObject({
        resolvedPrepaidRentMonths: 0,
        resolvedPrepaidRentAmount: 0,
      })
      const b = createContext()
      const fullResult = await b.service.updateRentalPackages(
        b.apartment._id.toHexString(),
        prepaidDto({ type: 'FULL' }, 12),
        'landlord-1',
        false
      )
      expect(fullResult.rentalPackages?.[0]).toMatchObject({
        resolvedPrepaidRentMonths: 12,
        resolvedPrepaidRentAmount: 120_000_000,
      })
    })

    it('rejects more prepaid months than the package lasts, and a missing month count', async () => {
      const a = createContext()
      await expect(
        a.service.updateRentalPackages(
          a.apartment._id.toHexString(),
          prepaidDto({ type: 'MONTHS', months: 4 }),
          'landlord-1',
          false
        )
      ).rejects.toThrow('invalid prepaid rent months')
      expect(a.repository.save).not.toHaveBeenCalled()

      const b = createContext()
      await expect(
        b.service.updateRentalPackages(
          b.apartment._id.toHexString(),
          prepaidDto({ type: 'MONTHS' }),
          'landlord-1',
          false
        )
      ).rejects.toThrow('prepaid rent months is required')
    })
  })

  describe('move-out response days', () => {
    const daysDto = (moveOutPolicy?: unknown): UpdateRentalPackagesDto =>
      ({
        expectedRevision: 1,
        rentalPackages: [
          {
            packageId: 'pkg-m',
            version: 1,
            durationMonths: 12,
            monthlyRent: 10_000_000,
            depositPolicy: { type: 'MONTHS_OF_RENT', months: 1 },
            status: 'active',
            ...(moveOutPolicy ? { moveOutPolicy } : {}),
          },
        ],
      }) as UpdateRentalPackagesDto

    it('stores the landlord-chosen response days', async () => {
      const context = createContext()
      const result = await context.service.updateRentalPackages(
        context.apartment._id.toHexString(),
        daysDto({ responseDays: 7 }),
        'landlord-1',
        false
      )
      expect(result.rentalPackages?.[0]?.moveOutPolicy).toEqual({
        responseDays: 7,
      })
    })

    it('defaults to 3 days when the field is missing', async () => {
      const context = createContext()
      const result = await context.service.updateRentalPackages(
        context.apartment._id.toHexString(),
        daysDto(),
        'landlord-1',
        false
      )
      expect(result.rentalPackages?.[0]?.moveOutPolicy).toEqual({
        responseDays: 3,
      })
    })

    it('rejects out-of-range days without saving', async () => {
      const context = createContext()
      await expect(
        context.service.updateRentalPackages(
          context.apartment._id.toHexString(),
          daysDto({ responseDays: 16 }),
          'landlord-1',
          false
        )
      ).rejects.toThrow('invalid move-out response days')
      expect(context.repository.save).not.toHaveBeenCalled()
    })
  })

  it('rejects non-owners and stale revisions before mutating packages', async () => {
    const context = createContext()
    await expect(
      context.service.updateRentalPackages(
        context.apartment._id.toHexString(),
        dto,
        'tenant-1',
        false
      )
    ).rejects.toBeInstanceOf(ForbiddenException)
    await expect(
      context.service.updateRentalPackages(
        context.apartment._id.toHexString(),
        { ...dto, expectedRevision: 0 },
        'landlord-1',
        false
      )
    ).rejects.toBeInstanceOf(ConflictException)
    expect(context.repository.save).not.toHaveBeenCalled()
  })

  it('allows staff to revise packages without changing listing ownership state', async () => {
    const context = createContext()
    const result = await context.service.updateRentalPackages(
      context.apartment._id.toHexString(),
      dto,
      'staff-1',
      true
    )

    expect(result.status).toBe('available')
    expect(result.isVerified).toBe(true)
    expect(result.pricingRevision).toBe(2)
  })
})
