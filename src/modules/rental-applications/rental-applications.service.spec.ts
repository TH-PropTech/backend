import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { ApartmentsService } from '../apartments/apartments.service'
import type { CreateRentalApplicationDto } from './dto/create-rental-application.dto'
import type { RentalApplication } from './schemas/rental-application.schema'
import { RentalApplicationsService } from './rental-applications.service'

function application(
  overrides: Partial<RentalApplication> = {}
): RentalApplication {
  return {
    _id: new ObjectId(),
    tenantId: 'tenant-1',
    apartmentId: 'apartment-1',
    landlordId: 'landlord-1',
    packageId: 'pkg-12',
    packageVersion: 1,
    packageSnapshot: {
      packageId: 'pkg-12',
      version: 1,
      durationMonths: 12,
      monthlyRent: 12_000_000,
      depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
      resolvedDepositAmount: 24_000_000,
    },
    contractId: null,
    depositAgreementId: null,
    applicationRevision: 1,
    pricingRevision: 1,
    listingSnapshot: null,
    reviewSnapshot: null,
    provisioningStatus: 'not-started',
    provisioningErrorCode: null,
    decisionIdempotencyKey: null,
    decisionNote: null,
    submittedAt: new Date(),
    decidedAt: null,
    occupants: 2,
    moveInDate: new Date('2030-01-01'),
    leaseDurationMonths: 12,
    occupation: 'Engineer',
    hasPets: false,
    notes: null,
    status: 'pending',
    reasonCode: null,
    actorId: null,
    actorTimestamp: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function input(
  overrides: Partial<CreateRentalApplicationDto> = {}
): CreateRentalApplicationDto {
  return {
    apartmentId: 'apartment-1',
    packageId: 'pkg-12',
    packageVersion: 1,
    occupants: 1,
    moveInDate: '2030-01-01',
    occupation: 'Student',
    hasPets: false,
    disclosureVersion: 'rental-review-v1',
    acknowledgedDisclosureIds: [
      'listing-terms',
      'pre-contract-request',
      'future-payment-and-signing',
    ],
    ...overrides,
  }
}

const apartment = {
  landlordId: 'landlord-1',
  status: 'available' as const,
  pricingMode: 'packages' as const,
  pricingRevision: 1,
  title: 'Apartment',
  address: 'Address',
  location: 'Address',
  area: 60,
  rentalPackages: [
    {
      packageId: 'pkg-12',
      version: 1,
      durationMonths: 12 as const,
      monthlyRent: 12_000_000,
      depositPolicy: { type: 'MONTHS_OF_RENT' as const, months: 2 },
      resolvedDepositAmount: 24_000_000,
      status: 'active' as const,
    },
  ],
}

describe('RentalApplicationsService', () => {
  const repository = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  }
  const apartments = { findOne: jest.fn() }
  const service = new RentalApplicationsService(
    repository as unknown as Repository<RentalApplication>,
    apartments as unknown as ApartmentsService
  )

  beforeEach(() => jest.clearAllMocks())

  it('creates a pending application with server-derived identities', async () => {
    apartments.findOne.mockResolvedValue(apartment)
    repository.findOne.mockResolvedValue(null)
    repository.create.mockImplementation(
      (value: unknown) => value as RentalApplication
    )
    repository.save.mockImplementation((value: unknown) =>
      Promise.resolve(value as RentalApplication)
    )

    const result = await service.create(
      'tenant-1',
      input({ occupants: 2, occupation: 'Engineer' })
    )

    expect(result).toEqual(
      expect.objectContaining({
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        status: 'pending',
        leaseDurationMonths: 12,
      })
    )
  })

  it('rejects past move-in dates and applying to own listing', async () => {
    apartments.findOne.mockResolvedValue(apartment)
    await expect(
      service.create('tenant-1', input({ moveInDate: '2020-01-01' }))
    ).rejects.toThrow(BadRequestException)
    apartments.findOne.mockResolvedValue({
      ...apartment,
      landlordId: 'tenant-1',
    })
    await expect(service.create('tenant-1', input())).rejects.toThrow(
      BadRequestException
    )
  })

  it('prevents duplicate pending applications', async () => {
    apartments.findOne.mockResolvedValue(apartment)
    repository.findOne.mockResolvedValue(application())
    await expect(service.create('tenant-1', input())).rejects.toThrow(
      ConflictException
    )
  })

  it('rejects a stale package version before creating an application', async () => {
    apartments.findOne.mockResolvedValue({
      ...apartment,
      rentalPackages: [{ ...apartment.rentalPackages[0], version: 2 }],
    })
    repository.findOne.mockResolvedValue(null)

    await expect(
      service.create('tenant-1', input({ packageVersion: 1 }))
    ).rejects.toThrow('PACKAGE_STALE')
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('lists records scoped to the actor', async () => {
    repository.find.mockResolvedValue([application()])
    await service.getMine('tenant-1', { page: 1, limit: 20 })
    expect(repository.find).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      order: { updatedAt: 'DESC' },
    })
    await service.getReceived('landlord-1', { page: 1, limit: 20 })
    expect(repository.find).toHaveBeenLastCalledWith({
      where: { landlordId: 'landlord-1' },
      order: { updatedAt: 'DESC' },
    })
  })

  it('records an owning landlord rejection with actor audit fields', async () => {
    repository.findOne.mockResolvedValue(application())
    repository.save.mockImplementation(value => Promise.resolve(value))
    const result = await service.respond(
      '507f1f77bcf86cd799439011',
      'landlord-1',
      { status: 'rejected', reasonCode: 'NOT_AVAILABLE' }
    )
    expect(result).toEqual(
      expect.objectContaining({
        status: 'rejected',
        reasonCode: 'NOT_AVAILABLE',
        actorId: 'landlord-1',
      })
    )
  })

  it('rejects another landlord and a second decision', async () => {
    repository.findOne.mockResolvedValueOnce(application())
    await expect(
      service.respond('507f1f77bcf86cd799439011', 'other', {
        status: 'rejected',
        reasonCode: 'OTHER',
      })
    ).rejects.toThrow(ForbiddenException)
    repository.findOne.mockResolvedValueOnce(
      application({ status: 'accepted' })
    )
    await expect(
      service.respond('507f1f77bcf86cd799439011', 'landlord-1', {
        status: 'rejected',
        reasonCode: 'OTHER',
      })
    ).rejects.toThrow(ConflictException)
  })

  it('returns not found for invalid IDs without repository access', async () => {
    await expect(
      service.respond('bad-id', 'landlord-1', {
        status: 'rejected',
        reasonCode: 'OTHER',
      })
    ).rejects.toThrow(NotFoundException)
    expect(repository.findOne).not.toHaveBeenCalled()
  })
})
