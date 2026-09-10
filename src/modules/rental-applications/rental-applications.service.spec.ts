import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { ApartmentsService } from '../apartments/apartments.service'
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
    apartments.findOne.mockResolvedValue({ landlordId: 'landlord-1' })
    repository.findOne.mockResolvedValue(null)
    repository.create.mockImplementation(
      (value: unknown): RentalApplication => value as RentalApplication
    )
    repository.save.mockImplementation(
      (value: unknown): Promise<RentalApplication> =>
        Promise.resolve(value as RentalApplication)
    )
    const result = await service.create('tenant-1', {
      apartmentId: 'apartment-1',
      occupants: 2,
      moveInDate: '2030-01-01',
      leaseDurationMonths: 12,
      occupation: 'Engineer',
      hasPets: false,
    })
    expect(result).toEqual(
      expect.objectContaining({
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        status: 'pending',
      })
    )
  })

  it('rejects past move-in dates and applying to own listing', async () => {
    apartments.findOne.mockResolvedValue({ landlordId: 'landlord-1' })
    await expect(
      service.create('tenant-1', {
        apartmentId: 'apartment-1',
        occupants: 1,
        moveInDate: '2020-01-01',
        leaseDurationMonths: 6,
        occupation: 'Student',
        hasPets: false,
      })
    ).rejects.toThrow(BadRequestException)
    apartments.findOne.mockResolvedValue({ landlordId: 'tenant-1' })
    await expect(
      service.create('tenant-1', {
        apartmentId: 'apartment-1',
        occupants: 1,
        moveInDate: '2030-01-01',
        leaseDurationMonths: 6,
        occupation: 'Student',
        hasPets: false,
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('prevents duplicate pending applications', async () => {
    apartments.findOne.mockResolvedValue({ landlordId: 'landlord-1' })
    repository.findOne.mockResolvedValue(application())
    await expect(
      service.create('tenant-1', {
        apartmentId: 'apartment-1',
        occupants: 1,
        moveInDate: '2030-01-01',
        leaseDurationMonths: 6,
        occupation: 'Student',
        hasPets: false,
      })
    ).rejects.toThrow(ConflictException)
  })

  it('rejects a stale package version before creating an application', async () => {
    apartments.findOne.mockResolvedValue({
      landlordId: 'landlord-1',
      pricingMode: 'packages',
      rentalPackages: [
        {
          packageId: 'pkg-12',
          version: 2,
          durationMonths: 12,
          monthlyRent: 12_000_000,
          depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
          resolvedDepositAmount: 24_000_000,
          status: 'active',
        },
      ],
    })
    repository.findOne.mockResolvedValue(null)

    await expect(
      service.create('tenant-1', {
        apartmentId: 'apartment-1',
        packageId: 'pkg-12',
        packageVersion: 1,
        occupants: 1,
        moveInDate: '2030-01-01',
        leaseDurationMonths: 6,
        occupation: 'Student',
        hasPets: false,
      })
    ).rejects.toThrow('PACKAGE_STALE')
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('lists only records scoped to the actor', async () => {
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

  it('records the owning landlord decision with actor audit fields', async () => {
    repository.findOne.mockResolvedValue(application())
    repository.save.mockImplementation(value => Promise.resolve(value))
    const result = await service.respond(
      '507f1f77bcf86cd799439011',
      'landlord-1',
      { status: 'accepted', reasonCode: 'meets_requirements' }
    )
    expect(result).toEqual(
      expect.objectContaining({
        status: 'accepted',
        reasonCode: 'meets_requirements',
        actorId: 'landlord-1',
      })
    )
    expect(result.actorTimestamp).toBeInstanceOf(Date)
  })

  it('rejects another landlord and a second decision', async () => {
    repository.findOne.mockResolvedValueOnce(application())
    await expect(
      service.respond('507f1f77bcf86cd799439011', 'other', {
        status: 'rejected',
        reasonCode: 'other',
      })
    ).rejects.toThrow(ForbiddenException)
    repository.findOne.mockResolvedValueOnce(
      application({ status: 'accepted' })
    )
    await expect(
      service.respond('507f1f77bcf86cd799439011', 'landlord-1', {
        status: 'rejected',
        reasonCode: 'other',
      })
    ).rejects.toThrow(ConflictException)
  })

  it('returns not found for invalid IDs without repository access', async () => {
    await expect(
      service.respond('bad-id', 'landlord-1', {
        status: 'accepted',
        reasonCode: 'ok',
      })
    ).rejects.toThrow(NotFoundException)
    expect(repository.findOne).not.toHaveBeenCalled()
  })
})
