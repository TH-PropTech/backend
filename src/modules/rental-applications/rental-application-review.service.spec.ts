import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { ConfigService } from '@nestjs/config'
import type { ApartmentsService } from '../apartments/apartments.service'
import type { DepositAgreementsService } from '../contracts/deposit-agreements.service'
import type { ContractsService } from '../contracts/contracts.service'
import type { RentalApplication } from './schemas/rental-application.schema'
import { RentalApplicationsService } from './rental-applications.service'

function buildApplication(
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
    ...overrides,
  } as unknown as RentalApplication
}

describe('RentalApplicationsService review-to-contract flow', () => {
  const repository = {
    create: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  }
  const apartments = {
    findOne: jest.fn(),
    reserveRentalApplication: jest.fn(),
  }
  const config = {
    get: jest.fn().mockReturnValue(true),
  }
  const deposits = {
    createFromApplicationSnapshot: jest.fn(),
  }
  const contracts = {
    createDraftFromApplication: jest.fn(),
  }
  const notifications = {
    createNotification: jest.fn(),
  }

  const service = new RentalApplicationsService(
    repository as unknown as Repository<RentalApplication>,
    apartments as unknown as ApartmentsService,
    config as unknown as ConfigService,
    deposits as unknown as DepositAgreementsService,
    contracts as unknown as ContractsService,
    notifications as unknown as import('../notifications/notifications.service').NotificationsService
  )

  beforeEach(() => jest.clearAllMocks())

  it('returns an eligible server-authoritative context with disclosure version', async () => {
    apartments.findOne.mockResolvedValue({
      _id: new ObjectId(),
      title: 'Sunrise Apartment',
      address: '1 Example Street',
      area: 68,
      status: 'available',
      isVerified: true,
      landlordId: 'landlord-1',
      pricingMode: 'packages',
      pricingRevision: 4,
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
      landlord: { fullName: 'Owner' },
    })

    const context = await service.getContext('tenant-1', 'apartment-1')

    expect(context.enabled).toBe(true)
    expect(context.eligible).toBe(true)
    expect(context.pricingRevision).toBe(4)
    expect(context.packages[0]?.packageId).toBe('pkg-12')
    expect(typeof context.disclosure.version).toBe('string')
    expect(context).not.toHaveProperty('tenantId')
    expect(context).not.toHaveProperty('walletBalance')
  })

  it('creates a pending application from package and disclosure snapshots', async () => {
    apartments.findOne.mockResolvedValue({
      _id: new ObjectId(),
      title: 'Sunrise Apartment',
      address: '1 Example Street',
      area: 68,
      status: 'available',
      isVerified: true,
      landlordId: 'landlord-1',
      pricingMode: 'packages',
      pricingRevision: 4,
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
    repository.create.mockImplementation(
      (value: unknown) => value as RentalApplication
    )
    repository.save.mockImplementation((value: unknown) =>
      Promise.resolve(value as RentalApplication)
    )

    const result = await service.create('tenant-1', {
      apartmentId: 'apartment-1',
      packageId: 'pkg-12',
      packageVersion: 2,
      occupants: 2,
      moveInDate: '2030-01-01',
      occupation: 'Engineer',
      hasPets: false,
      disclosureVersion: 'rental-review-v1',
      acknowledgedDisclosureIds: [
        'listing-terms',
        'pre-contract-request',
        'future-payment-and-signing',
      ],
    })

    expect(result).toEqual(
      expect.objectContaining({
        status: 'pending',
        packageId: 'pkg-12',
        packageVersion: 2,
        leaseDurationMonths: 12,
        provisioningStatus: 'not-started',
      })
    )
    expect(result.reviewSnapshot).toEqual(
      expect.objectContaining({ disclosureVersion: 'rental-review-v1' })
    )
  })

  it('provisions one deposit agreement and one contract draft when accept is retried', async () => {
    const accepted = buildApplication({
      applicationRevision: 1,
      status: 'pending',
      packageSnapshot: {
        packageId: 'pkg-12',
        version: 2,
        durationMonths: 12,
        monthlyRent: 12_000_000,
        depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
        resolvedDepositAmount: 24_000_000,
      },
    })
    const deposit = { _id: new ObjectId(), agreementCode: 'DPA-1' }
    const contract = { _id: new ObjectId(), status: 'draft' }
    repository.findOne.mockResolvedValue(accepted)
    repository.save.mockImplementation(value => Promise.resolve(value))
    apartments.findOne.mockResolvedValue({
      _id: new ObjectId(),
      title: 'Sunrise Apartment',
      address: '1 Example Street',
      area: 68,
      status: 'available',
      landlordId: 'landlord-1',
    })
    apartments.reserveRentalApplication.mockResolvedValue(true)
    deposits.createFromApplicationSnapshot.mockResolvedValue(deposit)
    contracts.createDraftFromApplication.mockResolvedValue(contract)

    const first = await service.respond(
      accepted._id.toHexString(),
      'landlord-1',
      {
        status: 'accepted',
        reasonCode: 'APPROVED',
        expectedRevision: 1,
        idempotencyKey: 'accept-1',
      }
    )
    repository.findOne.mockResolvedValue(first)
    const second = await service.respond(
      accepted._id.toHexString(),
      'landlord-1',
      {
        status: 'accepted',
        reasonCode: 'APPROVED',
        expectedRevision: 2,
        idempotencyKey: 'accept-1',
      }
    )

    expect(first.provisioningStatus).toBe('ready')
    expect(second.contractId).toBe(contract._id.toHexString())
    expect(deposits.createFromApplicationSnapshot).toHaveBeenCalledTimes(1)
    expect(contracts.createDraftFromApplication).toHaveBeenCalledTimes(1)
  })
})
