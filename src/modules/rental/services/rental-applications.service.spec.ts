import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { ApartmentsService } from '../../properties/services/apartments.service'
import type { LegalTermsService } from '../../legal/services/legal-terms.service'
import type { RentalFlowConfigResolver } from './rental-flow-config-resolver.service'
import type { CreateRentalApplicationDto } from '../dto/create-rental-application.dto'
import type { RentalApplication } from '../schemas/rental-application.schema'
import { RentalApplicationsService } from './rental-applications.service'
import type { OwnershipTransferResolver } from '../../contracts/services/ownership-transfer.resolver'
import {
  DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS,
  computeRentalExecutionPolicyHash,
  getDefaultRentalExecutionPolicyRef,
} from '../utils/rental-execution-policy.util'
import { RentalTransactionEventService } from './rental-transaction-event.service'
import type { RentalTransactionEvent } from '../schemas/rental-transaction-event.schema'

function createInMemoryTransactionEventService(): {
  service: RentalTransactionEventService
  events: RentalTransactionEvent[]
} {
  const events: RentalTransactionEvent[] = []
  const repository = {
    findOne: jest.fn(({ where }: { where: { transitionKey: string } }) =>
      Promise.resolve(
        events.find(event => event.transitionKey === where.transitionKey) ??
          null
      )
    ),
    create: jest.fn(
      (input: Partial<RentalTransactionEvent>) =>
        ({ ...input }) as RentalTransactionEvent
    ),
    save: jest.fn((event: RentalTransactionEvent) => {
      events.push(event)
      return Promise.resolve(event)
    }),
  }
  return {
    service: new RentalTransactionEventService(repository as never),
    events,
  }
}

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

  beforeEach(() => {
    jest.clearAllMocks()
    repository.findOne.mockResolvedValue(null)
  })

  it('creates a pending application with server-derived identities', async () => {
    apartments.findOne.mockResolvedValue(apartment)
    repository.findOne.mockResolvedValue(null)
    repository.create.mockImplementation(
      (value: unknown) =>
        ({ _id: new ObjectId(), ...(value as object) }) as RentalApplication
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

  it('rejects stale tenant fee quotes and requires tenant acknowledgement', async () => {
    const feeSnapshot = {
      scheduleId: 'fee-v1',
      version: 1,
      contentHash: 'a'.repeat(64),
      quote: [
        {
          feeKind: 'LANDLORD_COMMISSION' as const,
          payerRole: 'landlord' as const,
          amountBeforeVat: 1_000_000,
          vatAmount: 100_000,
          amount: 1_100_000,
        },
        {
          feeKind: 'TENANT_SERVICE' as const,
          payerRole: 'tenant' as const,
          amountBeforeVat: 200_000,
          vatAmount: 20_000,
          amount: 220_000,
        },
      ],
    }
    const platformFees = { quote: jest.fn().mockResolvedValue(feeSnapshot) }
    const moduleRefStub = { get: jest.fn().mockReturnValue(platformFees) }
    const feeService = new RentalApplicationsService(
      repository as unknown as Repository<RentalApplication>,
      apartments as unknown as ApartmentsService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      moduleRefStub as never
    )
    apartments.findOne.mockResolvedValue(apartment)
    repository.findOne.mockResolvedValue(null)
    repository.create.mockImplementation(
      (value: unknown) =>
        ({ _id: new ObjectId(), ...(value as object) }) as RentalApplication
    )
    repository.save.mockImplementation((value: unknown) =>
      Promise.resolve(value as RentalApplication)
    )

    await expect(
      feeService.create(
        'tenant-1',
        input({
          feeScheduleId: 'fee-v1',
          feeScheduleVersion: 1,
          feeContentHash: 'b'.repeat(64),
        })
      )
    ).rejects.toThrow('PLATFORM_FEE_QUOTE_STALE')
    await expect(
      feeService.create(
        'tenant-1',
        input({
          feeScheduleId: 'fee-v1',
          feeScheduleVersion: 1,
          feeContentHash: feeSnapshot.contentHash,
        })
      )
    ).rejects.toBeInstanceOf(UnprocessableEntityException)
    const created = await feeService.create(
      'tenant-1',
      input({
        feeScheduleId: 'fee-v1',
        feeScheduleVersion: 1,
        feeContentHash: feeSnapshot.contentHash,
        feeAcknowledgedHash: feeSnapshot.contentHash,
      })
    )
    expect(created.feeSnapshot?.contentHash).toBe(feeSnapshot.contentHash)

    platformFees.quote.mockResolvedValueOnce(null)
    await expect(
      feeService.create(
        'tenant-1',
        input({
          feeScheduleId: 'fee-v1',
          feeScheduleVersion: 1,
          feeContentHash: feeSnapshot.contentHash,
        })
      )
    ).rejects.toThrow('PLATFORM_FEE_QUOTE_STALE')
  })

  it('rejects a co-occupant list that does not match the total occupants', async () => {
    apartments.findOne.mockResolvedValue(apartment)

    await expect(
      service.create(
        'tenant-1',
        Object.assign(input({ occupants: 3 }), { occupantsDetail: [] })
      )
    ).rejects.toThrow('APPLICATION_OCCUPANTS_MISMATCH')
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('masks the other party fee line in application responses', async () => {
    const stored = application({
      emergencyContact: {
        fullName: 'Contact',
        relationship: 'Friend',
        phone: '+84912345678',
      },
      feeSnapshot: {
        scheduleId: 'fees',
        version: 1,
        contentHash: 'a'.repeat(64),
        quote: [
          {
            feeKind: 'LANDLORD_COMMISSION',
            payerRole: 'landlord',
            amountBeforeVat: 1_000,
            vatAmount: 100,
            amount: 1_100,
          },
          {
            feeKind: 'TENANT_SERVICE',
            payerRole: 'tenant',
            amountBeforeVat: 2_000,
            vatAmount: 200,
            amount: 2_200,
          },
        ],
      },
    })
    repository.findOne.mockResolvedValue(stored)
    const tenantView = await service.getOne(
      stored._id.toHexString(),
      'tenant-1'
    )
    const landlordView = await service.getOne(
      stored._id.toHexString(),
      'landlord-1'
    )
    expect(tenantView.feeSnapshot?.quote.map(line => line.feeKind)).toEqual([
      'TENANT_SERVICE',
    ])
    expect(landlordView.feeSnapshot?.quote.map(line => line.feeKind)).toEqual([
      'LANDLORD_COMMISSION',
    ])
    expect(landlordView.emergencyContact?.phone).not.toBe(
      stored.emergencyContact?.phone
    )
    expect(stored.feeSnapshot?.quote).toHaveLength(2)
  })

  it('rejects a requested payment cycle that is not enabled by the package', async () => {
    apartments.findOne.mockResolvedValue({
      ...apartment,
      rentalPackages: [
        {
          ...(apartment.rentalPackages[0] ?? {}),
          settlementPolicy: {
            allowedPaymentCycles: [1, 3],
            defaultPaymentCycle: 1,
            firstPaymentDueOffsetDays: 3,
          },
        },
      ],
    })

    await expect(
      service.create(
        'tenant-1',
        Object.assign(input(), { selectedPaymentCycleMonths: 6 })
      )
    ).rejects.toThrow('PAYMENT_CYCLE_NOT_ALLOWED')
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('rejects a viewing booking belonging to another tenant', async () => {
    const bookings = {
      findOneById: jest.fn().mockResolvedValue({
        tenantId: 'another-tenant',
        apartmentId: 'apartment-1',
        status: 'confirmed',
      }),
    }
    Reflect.set(service, 'bookingsService', bookings)
    apartments.findOne.mockResolvedValue(apartment)

    await expect(
      service.create(
        'tenant-1',
        Object.assign(input(), {
          viewingBookingId: '507f1f77bcf86cd799439011',
        })
      )
    ).rejects.toThrow('APPLICATION_VIEWING_INVALID')
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('masks emergency contact phone numbers in landlord detail responses', async () => {
    const record = Object.assign(application(), {
      emergencyContact: {
        fullName: 'Contact',
        relationship: 'Parent',
        phone: '+84912345678',
      },
    })
    repository.findOne.mockResolvedValue(record)

    const result = await service.getOne(record._id.toHexString(), 'landlord-1')

    const resultContact = Reflect.get(result, 'emergencyContact') as
      | { phone: string }
      | undefined
    const originalContact = Reflect.get(record, 'emergencyContact') as
      | { phone: string }
      | undefined
    expect(resultContact?.phone).toBe('+84*******78')
    expect(originalContact?.phone).toBe('+84912345678')
  })

  it('reports the disabled context and blocks creation when v4 is disabled', async () => {
    const disabledConfig = {
      get: jest.fn().mockReturnValue(false),
    }
    const disabledService = new RentalApplicationsService(
      repository as unknown as Repository<RentalApplication>,
      apartments as unknown as ApartmentsService,
      disabledConfig as unknown as ConfigService
    )
    apartments.findOne.mockResolvedValue(apartment)

    await expect(
      disabledService.getContext('tenant-1', 'apartment-1')
    ).resolves.toMatchObject({
      enabled: false,
      eligible: false,
      reasonCode: 'RENTAL_FLOW_DISABLED',
    })
    apartments.findOne.mockClear()
    await expect(disabledService.create('tenant-1', input())).rejects.toThrow(
      'RENTAL_FLOW_DISABLED'
    )
    expect(apartments.findOne).not.toHaveBeenCalled()
  })

  it('snapshots the tenant-selected execution policy when a package exposes two options', async () => {
    const depositFirst = getDefaultRentalExecutionPolicyRef()
    const signFirstInput = DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS[0]
    const signFirst = {
      policyId: signFirstInput.policyId,
      version: 1,
      strategy: signFirstInput.strategy,
      contentHash: computeRentalExecutionPolicyHash({
        ...signFirstInput,
        version: 1,
      }),
    }
    apartments.findOne.mockResolvedValue({
      ...apartment,
      rentalPackages: [
        {
          ...apartment.rentalPackages[0],
          allowedExecutionPolicies: [depositFirst, signFirst],
          defaultExecutionPolicy: depositFirst,
        },
      ],
    })
    repository.findOne.mockResolvedValue(null)
    repository.create.mockImplementation(
      (value: unknown) =>
        ({ _id: new ObjectId(), ...(value as object) }) as RentalApplication
    )
    repository.save.mockImplementation(value => Promise.resolve(value))

    const result = await service.create(
      'tenant-1',
      input({ selectedExecutionPolicy: signFirst })
    )

    expect(result.executionPolicySnapshot).toEqual(signFirst)
    expect(result.packageSnapshot?.defaultExecutionPolicy).toEqual(signFirst)
    expect(result.reviewSnapshot?.reviewHash).toBeDefined()
  })

  it('requires a selection when a package exposes multiple execution policies', async () => {
    const depositFirst = getDefaultRentalExecutionPolicyRef()
    const signFirstInput = DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS[0]
    const signFirst = {
      policyId: signFirstInput.policyId,
      version: 1,
      strategy: signFirstInput.strategy,
      contentHash: computeRentalExecutionPolicyHash({
        ...signFirstInput,
        version: 1,
      }),
    }
    apartments.findOne.mockResolvedValue({
      ...apartment,
      rentalPackages: [
        {
          ...apartment.rentalPackages[0],
          allowedExecutionPolicies: [depositFirst, signFirst],
          defaultExecutionPolicy: depositFirst,
        },
      ],
    })
    repository.findOne.mockResolvedValue(null)

    await expect(service.create('tenant-1', input())).rejects.toThrow(
      'RENTAL_EXECUTION_POLICY_SELECTION_REQUIRED'
    )
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('projects a ready contract handoff only after accepted provisioning completes', async () => {
    const ready = application({
      status: 'accepted',
      provisioningStatus: 'ready',
      contractId: '507f1f77bcf86cd799439011',
    })
    repository.findOne.mockResolvedValue(ready)

    const result = await service.getOne(ready._id.toHexString(), 'tenant-1')

    expect(result.contractHandoff).toEqual({
      state: 'ready',
      contractId: '507f1f77bcf86cd799439011',
      href: '/contracts/507f1f77bcf86cd799439011',
      reasonCode: null,
    })
  })

  it('does not expose a contract handoff to an unrelated actor', async () => {
    const pending = application()
    repository.findOne.mockResolvedValue(pending)

    await expect(
      service.getOne(pending._id.toHexString(), 'outsider')
    ).rejects.toThrow('APPLICATION_ACCESS_DENIED')
  })

  it('lists a closed application for a verified successor while preserving provenance', async () => {
    const transferredApplication = application({
      apartmentId: new ObjectId().toString(),
      landlordId: 'original-landlord',
      originalLandlordId: 'original-landlord',
      ownershipTransferId: 'transfer-1',
      status: 'accepted',
      actorId: 'original-landlord',
    })
    const ownershipTransferResolver = {
      canAccessProperty: jest.fn().mockResolvedValue(true),
    }
    const serviceWithResolver = new RentalApplicationsService(
      repository as unknown as Repository<RentalApplication>,
      apartments as unknown as ApartmentsService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ownershipTransferResolver as unknown as OwnershipTransferResolver
    )
    repository.find.mockResolvedValue([transferredApplication])

    const result = await serviceWithResolver.getReceived('successor-landlord', {
      page: 1,
      limit: 20,
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        originalLandlordId: 'original-landlord',
        ownershipTransferId: 'transfer-1',
      })
    )
    expect(ownershipTransferResolver.canAccessProperty).toHaveBeenCalledWith(
      'successor-landlord',
      transferredApplication.apartmentId,
      'original-landlord'
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

  it('retries provisionAcceptedApplication when status is accepted and provisioningStatus was failed', async () => {
    const existing = application({
      status: 'accepted',
      provisioningStatus: 'failed',
      provisioningErrorCode: 'RENTAL_RESERVATION_CONFLICT',
    })
    repository.findOne.mockResolvedValue(existing)

    const result = await service.respond(
      '507f1f77bcf86cd799439011',
      'landlord-1',
      { status: 'accepted', reasonCode: 'APPROVED' }
    )

    expect(result.status).toBe('accepted')
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

  it('rejects application creation with 409 TERMS_STALE when terms version or hash does not match published terms', async () => {
    apartments.findOne.mockResolvedValue(apartment)
    repository.findOne.mockResolvedValue(null)

    const legalTermsMock = {
      getCurrentPublishedTerms: jest.fn().mockResolvedValue({
        key: 'rental-service-terms',
        version: 2,
        contentHash: 'valid-hash-v2',
      }),
    }

    const serviceWithTerms = new RentalApplicationsService(
      repository as unknown as Repository<RentalApplication>,
      apartments as unknown as ApartmentsService,
      undefined,
      undefined,
      undefined,
      undefined,
      legalTermsMock as unknown as LegalTermsService
    )

    await expect(
      serviceWithTerms.create(
        'tenant-1',
        input({
          acceptedTermsVersion: 1, // Stale version!
          acceptedTermsHash: 'old-hash',
        })
      )
    ).rejects.toThrow(ConflictException)
  })

  it('records termsRef in reviewSnapshot when valid terms are accepted', async () => {
    apartments.findOne.mockResolvedValue(apartment)
    repository.findOne.mockResolvedValue(null)
    repository.create.mockImplementation(
      (value: unknown) =>
        ({ _id: new ObjectId(), ...(value as object) }) as RentalApplication
    )
    repository.save.mockImplementation(value => Promise.resolve(value))

    const legalTermsMock = {
      getCurrentPublishedTerms: jest.fn().mockResolvedValue({
        key: 'rental-service-terms',
        version: 1,
        contentHash: 'hash-v1',
      }),
    }

    const serviceWithTerms = new RentalApplicationsService(
      repository as unknown as Repository<RentalApplication>,
      apartments as unknown as ApartmentsService,
      undefined,
      undefined,
      undefined,
      undefined,
      legalTermsMock as unknown as LegalTermsService
    )

    const result = await serviceWithTerms.create(
      'tenant-1',
      input({
        acceptedTermsVersion: 1,
        acceptedTermsHash: 'hash-v1',
      })
    )

    expect(result.reviewSnapshot?.termsRef).toEqual({
      key: 'rental-service-terms',
      version: 1,
      contentHash: 'hash-v1',
    })
    expect(result.reviewSnapshot?.reviewHash).toBeDefined()
  })

  describe('Step 1 Flow Profile validations', () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const flowResolverMock = {
      resolveProfile: jest.fn().mockResolvedValue({
        profileId: 'flow-p1',
        version: 2,
        hash: 'flow-hash-v2',
        precedence: 'GLOBAL',
        steps: {
          step1: {
            moveInDateLabel: 'Ngày vào ở dự kiến',
            minMoveInLeadDays: 3,
            maxMoveInLeadDays: 30,
            minOccupants: 2,
            maxOccupants: 4,
            allowNotes: true,
            notesMaxLength: 500,
          },
        },
      }),
    }

    const serviceWithFlow = new RentalApplicationsService(
      repository as unknown as Repository<RentalApplication>,
      apartments as unknown as ApartmentsService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      flowResolverMock as unknown as RentalFlowConfigResolver
    )

    it('rejects when moveInDate lead days is less than minMoveInLeadDays', async () => {
      apartments.findOne.mockResolvedValue(apartment)
      repository.findOne.mockResolvedValue(null)

      const tooEarly = new Date(today)
      tooEarly.setDate(today.getDate() + 1) // 1 day lead, min is 3

      await expect(
        serviceWithFlow.create(
          'tenant-1',
          input({
            moveInDate: tooEarly.toISOString().split('T')[0]!,
            occupants: 2,
            flowProfileVersion: 2,
            flowProfileHash: 'flow-hash-v2',
          })
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects when moveInDate lead days exceeds maxMoveInLeadDays', async () => {
      apartments.findOne.mockResolvedValue(apartment)
      repository.findOne.mockResolvedValue(null)

      const tooLate = new Date(today)
      tooLate.setDate(today.getDate() + 45) // 45 days lead, max is 30

      await expect(
        serviceWithFlow.create(
          'tenant-1',
          input({
            moveInDate: tooLate.toISOString().split('T')[0]!,
            occupants: 2,
            flowProfileVersion: 2,
            flowProfileHash: 'flow-hash-v2',
          })
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects when occupants is below minOccupants or above maxOccupants', async () => {
      apartments.findOne.mockResolvedValue(apartment)
      repository.findOne.mockResolvedValue(null)

      const validDate = new Date(today)
      validDate.setDate(today.getDate() + 10)

      // Below minOccupants (min is 2, testing with 1)
      await expect(
        serviceWithFlow.create(
          'tenant-1',
          input({
            moveInDate: validDate.toISOString().split('T')[0]!,
            occupants: 1,
            flowProfileVersion: 2,
            flowProfileHash: 'flow-hash-v2',
          })
        )
      ).rejects.toThrow(BadRequestException)

      // Above maxOccupants (max is 4, testing with 5)
      await expect(
        serviceWithFlow.create(
          'tenant-1',
          input({
            moveInDate: validDate.toISOString().split('T')[0]!,
            occupants: 5,
            flowProfileVersion: 2,
            flowProfileHash: 'flow-hash-v2',
          })
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('succeeds when moveInDate and occupants satisfy Step 1 flow profile rules', async () => {
      apartments.findOne.mockResolvedValue(apartment)
      repository.findOne.mockResolvedValue(null)
      repository.create.mockImplementation(
        (value: unknown) =>
          ({ _id: new ObjectId(), ...(value as object) }) as RentalApplication
      )
      repository.save.mockImplementation(value => Promise.resolve(value))

      const validDate = new Date(today)
      validDate.setDate(today.getDate() + 10) // 10 days lead: 3 <= 10 <= 30

      const result = await serviceWithFlow.create(
        'tenant-1',
        input({
          moveInDate: validDate.toISOString().split('T')[0]!,
          occupants: 3, // 2 <= 3 <= 4
          flowProfileVersion: 2,
          flowProfileHash: 'flow-hash-v2',
        })
      )

      expect(result).toBeDefined()
      expect(result.occupants).toBe(3)
    })
  })
})

describe('RentalApplicationsService transaction audit', () => {
  it('records exactly one application.provisioned event even if provisioning runs twice for the same application', async () => {
    const repository = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const apartments = {
      findOne: jest.fn().mockResolvedValue({ title: 'Apartment' }),
      reserveRentalApplication: jest.fn().mockResolvedValue(true),
    }
    const depositAgreementsService = {
      createFromApplicationSnapshot: jest.fn().mockResolvedValue({
        _id: new ObjectId(),
      }),
    }
    const contractsService = {
      createDraftFromApplication: jest.fn().mockResolvedValue({
        _id: new ObjectId(),
      }),
    }
    const { service: transactionEventService, events } =
      createInMemoryTransactionEventService()
    const service = new RentalApplicationsService(
      repository as unknown as Repository<RentalApplication>,
      apartments as unknown as ApartmentsService,
      undefined,
      depositAgreementsService as never,
      contractsService as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      transactionEventService
    )

    const app = application({ packageSnapshot: {} as never })
    const provisionOnce = async (): Promise<void> => {
      await (
        service as unknown as {
          provisionAcceptedApplication: (
            application: RentalApplication
          ) => Promise<RentalApplication>
        }
      ).provisionAcceptedApplication(app)
    }

    await provisionOnce()
    await provisionOnce()

    const provisionedEvents = events.filter(
      event => event.eventType === 'application.provisioned'
    )
    expect(provisionedEvents).toHaveLength(1)
  })
})
