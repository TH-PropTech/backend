import { ObjectId } from 'mongodb'
import { NotFoundException } from '@nestjs/common'
import type { Repository } from 'typeorm'
import { ApartmentsService } from './apartments.service'
import { Apartment } from './schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'
import type { NotificationsService } from '../notifications/notifications.service'
import type { ProjectsService } from '../projects/projects.service'
import type { BuildingsService } from '../buildings/buildings.service'
import type { SavedSearchesService } from '../saved-searches/saved-searches.service'

describe('ApartmentsService current landlord projection', () => {
  type ApartmentWithLandlord = Apartment & { landlord?: User | null }
  type ServiceTestContext = {
    service: ApartmentsService
    apartmentRepository: jest.Mocked<Repository<Apartment>>
    userRepository: jest.Mocked<Repository<User>>
  }

  const apartmentId = new ObjectId('507f1f77bcf86cd799439011')
  const landlordId = new ObjectId('507f1f77bcf86cd799439012')

  const createApartment = (currentLandlordId: string): Apartment =>
    ({
      _id: apartmentId,
      landlordId: currentLandlordId,
    }) as unknown as Apartment

  const createLandlord = (): User =>
    ({
      _id: landlordId,
      fullName: 'Current Landlord',
      email: 'current@example.com',
    }) as unknown as User

  const createService = (): ServiceTestContext => {
    const apartmentRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<Apartment>>
    const userRepository = {
      find: jest.fn(),
    } as unknown as jest.Mocked<Repository<User>>

    const service = new ApartmentsService(
      apartmentRepository,
      userRepository,
      {} as NotificationsService,
      {} as ProjectsService,
      {} as BuildingsService,
      {} as SavedSearchesService
    )

    return { service, apartmentRepository, userRepository }
  }

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('resolves the current landlord for the public apartment list', async () => {
    const { service, apartmentRepository, userRepository } = createService()
    const apartment = createApartment(landlordId.toHexString())
    const landlord = createLandlord()
    apartmentRepository.find.mockResolvedValue([apartment])
    userRepository.find.mockResolvedValue([landlord])

    const result = await service.findAll()

    expect(userRepository.find.mock.calls).toEqual([
      [
        {
          where: {
            _id: { $in: [landlordId] },
          },
        },
      ],
    ])
    expect((result[0] as ApartmentWithLandlord | undefined)?.landlord).toBe(
      landlord
    )
  })

  it('resolves the current landlord for landlord-owned listings', async () => {
    const { service, apartmentRepository, userRepository } = createService()
    const apartment = createApartment(landlordId.toHexString())
    const landlord = createLandlord()
    apartmentRepository.find.mockResolvedValue([apartment])
    userRepository.find.mockResolvedValue([landlord])

    const result = await service.findByLandlord(landlordId.toHexString())

    expect((result[0] as ApartmentWithLandlord | undefined)?.landlord).toBe(
      landlord
    )
  })

  it('does not query users when the list is empty', async () => {
    const { service, apartmentRepository, userRepository } = createService()
    apartmentRepository.find.mockResolvedValue([])

    const result = await service.findAll()

    expect(result).toEqual([])
    expect(userRepository.find.mock.calls).toHaveLength(0)
  })

  it('returns a null landlord when a legacy apartment has no valid owner id', async () => {
    const { service, apartmentRepository, userRepository } = createService()
    apartmentRepository.find.mockResolvedValue([
      createApartment('legacy-owner'),
    ])

    const result = await service.findAll()

    expect(
      (result[0] as ApartmentWithLandlord | undefined)?.landlord
    ).toBeNull()
    expect(userRepository.find.mock.calls).toHaveLength(0)
  })

  it('returns a null landlord when the current owner record is missing', async () => {
    const { service, apartmentRepository, userRepository } = createService()
    apartmentRepository.find.mockResolvedValue([
      createApartment(landlordId.toHexString()),
    ])
    userRepository.find.mockResolvedValue([])

    const result = await service.findAll()

    expect(
      (result[0] as ApartmentWithLandlord | undefined)?.landlord
    ).toBeNull()
  })
})

describe('ApartmentsService.reserveRentalApplication', () => {
  const apartmentId = new ObjectId('507f1f77bcf86cd799439011')
  const applicationId = 'app-123'

  type ReserveTestContext = {
    service: ApartmentsService
    apartmentRepository: jest.Mocked<Repository<Apartment>>
  }

  const createService = (): ReserveTestContext => {
    const apartmentRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<Repository<Apartment>>
    const userRepository = {
      find: jest.fn(),
    } as unknown as jest.Mocked<Repository<User>>

    const service = new ApartmentsService(
      apartmentRepository,
      userRepository,
      {} as NotificationsService,
      {} as ProjectsService,
      {} as BuildingsService,
      {} as SavedSearchesService
    )

    return { service, apartmentRepository }
  }

  it('Dimension 1: reserves an available apartment successfully', async () => {
    const { service, apartmentRepository } = createService()
    const apartment = {
      _id: apartmentId,
      status: 'available',
      rentalReservation: null,
    } as unknown as Apartment
    apartmentRepository.findOne.mockResolvedValue(apartment)
    apartmentRepository.update.mockResolvedValue({
      affected: 1,
      generatedMaps: [],
      raw: {},
    })

    const result = await service.reserveRentalApplication(
      apartmentId.toHexString(),
      applicationId
    )

    expect(result).toBe(true)
    expect(apartment.rentalReservation).toEqual(
      expect.objectContaining({
        applicationId,
        mode: 'application-accepted',
      })
    )
    expect(apartmentRepository.update.mock.calls).toHaveLength(1)
    expect(apartmentRepository.update.mock.calls[0]?.[0]).toEqual({
      _id: apartmentId,
      status: 'available',
      rentalReservation: null,
    })
    expect(apartmentRepository.update.mock.calls[0]?.[1]).toHaveProperty(
      'rentalReservation.applicationId',
      applicationId
    )
    expect(apartmentRepository.update.mock.calls[0]?.[1]).toHaveProperty(
      'rentalReservation.mode',
      'application-accepted'
    )
    expect(apartmentRepository.save.mock.calls).toHaveLength(0)
  })

  it('Dimension 2: returns true idempotently if already reserved by the same application', async () => {
    const { service, apartmentRepository } = createService()
    const reservedAt = new Date('2026-09-20T10:00:00Z')
    const apartment = {
      _id: apartmentId,
      status: 'available',
      rentalReservation: {
        applicationId,
        reservedAt,
        mode: 'application-accepted',
      },
    } as unknown as Apartment
    apartmentRepository.findOne.mockResolvedValue(apartment)

    const result = await service.reserveRentalApplication(
      apartmentId.toHexString(),
      applicationId
    )

    expect(result).toBe(true)
    expect(apartmentRepository.save.mock.calls).toHaveLength(0)
  })

  it('Dimension 3: throws NotFoundException for invalid apartmentId ObjectId', async () => {
    const { service } = createService()

    await expect(
      service.reserveRentalApplication('invalid-id', applicationId)
    ).rejects.toThrow(NotFoundException)
  })

  it('Dimension 3: throws NotFoundException if apartment does not exist', async () => {
    const { service, apartmentRepository } = createService()
    apartmentRepository.findOne.mockResolvedValue(null)

    await expect(
      service.reserveRentalApplication(apartmentId.toHexString(), applicationId)
    ).rejects.toThrow(NotFoundException)
  })

  it('Dimension 4: returns false if apartment is reserved by a different application', async () => {
    const { service, apartmentRepository } = createService()
    const apartment = {
      _id: apartmentId,
      status: 'available',
      rentalReservation: {
        applicationId: 'other-app',
        reservedAt: new Date(),
        mode: 'application-accepted',
      },
    } as unknown as Apartment
    apartmentRepository.findOne.mockResolvedValue(apartment)

    const result = await service.reserveRentalApplication(
      apartmentId.toHexString(),
      applicationId
    )

    expect(result).toBe(false)
    expect(apartmentRepository.save.mock.calls).toHaveLength(0)
  })

  it('Dimension 5: returns false if apartment status is not available', async () => {
    const { service, apartmentRepository } = createService()
    const apartment = {
      _id: apartmentId,
      status: 'rented',
      rentalReservation: null,
    } as unknown as Apartment
    apartmentRepository.findOne.mockResolvedValue(apartment)

    const result = await service.reserveRentalApplication(
      apartmentId.toHexString(),
      applicationId
    )

    expect(result).toBe(false)
    expect(apartmentRepository.save.mock.calls).toHaveLength(0)
  })

  it('returns false when the CAS loses to a different application', async () => {
    const { service, apartmentRepository } = createService()
    const apartment = {
      _id: apartmentId,
      status: 'available',
      rentalReservation: null,
    } as unknown as Apartment
    const competingReservation = {
      _id: apartmentId,
      status: 'available',
      rentalReservation: {
        applicationId: 'other-app',
        reservedAt: new Date(),
        mode: 'application-accepted',
      },
    } as unknown as Apartment
    apartmentRepository.findOne
      .mockResolvedValueOnce(apartment)
      .mockResolvedValueOnce(competingReservation)
    apartmentRepository.update.mockResolvedValue({
      affected: 0,
      generatedMaps: [],
      raw: {},
    })

    const result = await service.reserveRentalApplication(
      apartmentId.toHexString(),
      applicationId
    )

    expect(result).toBe(false)
    expect(apartmentRepository.update.mock.calls).toHaveLength(1)
    expect(apartmentRepository.save.mock.calls).toHaveLength(0)
  })

  it('returns true when the CAS loses but the same application won the retry', async () => {
    const { service, apartmentRepository } = createService()
    const apartment = {
      _id: apartmentId,
      status: 'available',
      rentalReservation: null,
    } as unknown as Apartment
    const retriedReservation = {
      _id: apartmentId,
      status: 'available',
      rentalReservation: {
        applicationId,
        reservedAt: new Date(),
        mode: 'application-accepted',
      },
    } as unknown as Apartment
    apartmentRepository.findOne
      .mockResolvedValueOnce(apartment)
      .mockResolvedValueOnce(retriedReservation)
    apartmentRepository.update.mockResolvedValue({
      affected: 0,
      generatedMaps: [],
      raw: {},
    })

    const result = await service.reserveRentalApplication(
      apartmentId.toHexString(),
      applicationId
    )

    expect(result).toBe(true)
    expect(apartmentRepository.save.mock.calls).toHaveLength(0)
  })

  it('projects a matching reservation to deposit-paid idempotently', async () => {
    const { service, apartmentRepository } = createService()
    const apartment = {
      _id: apartmentId,
      rentalReservation: {
        applicationId,
        reservedAt: new Date('2026-09-20T10:00:00Z'),
        mode: 'application-accepted',
      },
    } as unknown as Apartment
    apartmentRepository.findOne.mockResolvedValue(apartment)
    apartmentRepository.save.mockResolvedValue(apartment)

    await expect(
      service.markRentalDepositPaid(
        apartmentId.toHexString(),
        applicationId,
        'deposit-1'
      )
    ).resolves.toBe(true)
    expect(apartment.rentalReservation).toEqual(
      expect.objectContaining({
        applicationId,
        mode: 'deposit-paid',
        depositAgreementId: 'deposit-1',
      })
    )
    expect(apartmentRepository.save.mock.calls).toHaveLength(1)

    apartmentRepository.save.mockClear()
    await expect(
      service.markRentalDepositPaid(
        apartmentId.toHexString(),
        applicationId,
        'deposit-1'
      )
    ).resolves.toBe(true)
    expect(apartmentRepository.save.mock.calls).toHaveLength(0)

    await expect(
      service.markRentalDepositPaid(
        apartmentId.toHexString(),
        applicationId,
        'different-deposit'
      )
    ).resolves.toBe(false)
    expect(apartmentRepository.save.mock.calls).toHaveLength(0)
  })

  it('rejects deposit projection for another application', async () => {
    const { service, apartmentRepository } = createService()
    apartmentRepository.findOne.mockResolvedValue({
      _id: apartmentId,
      rentalReservation: {
        applicationId: 'other-app',
        reservedAt: new Date(),
        mode: 'application-accepted',
      },
    } as unknown as Apartment)

    await expect(
      service.markRentalDepositPaid(
        apartmentId.toHexString(),
        applicationId,
        'deposit-1'
      )
    ).resolves.toBe(false)
    expect(apartmentRepository.save.mock.calls).toHaveLength(0)
  })

  it('projects a matching reservation to an active lease and releases it by application guard', async () => {
    const { service, apartmentRepository } = createService()
    const apartment = {
      _id: apartmentId,
      rentalReservation: {
        applicationId,
        reservedAt: new Date(),
        mode: 'deposit-paid',
        depositAgreementId: 'deposit-1',
      },
    } as unknown as Apartment
    apartmentRepository.findOne.mockResolvedValue(apartment)
    apartmentRepository.save.mockResolvedValue(apartment)

    await expect(
      service.markRentalLeaseActive(
        apartmentId.toHexString(),
        applicationId,
        'contract-1'
      )
    ).resolves.toBe(true)
    expect(apartment.rentalReservation).toEqual(
      expect.objectContaining({ contractId: 'contract-1' })
    )

    await expect(
      service.markRentalLeaseActive(
        apartmentId.toHexString(),
        applicationId,
        'different-contract'
      )
    ).resolves.toBe(false)

    await expect(
      service.releaseRentalReservation(
        apartmentId.toHexString(),
        'different-application'
      )
    ).resolves.toBe(false)
    expect(apartment.rentalReservation).not.toBeNull()

    await expect(
      service.releaseRentalReservation(apartmentId.toHexString(), applicationId)
    ).resolves.toBe(false)
    expect(apartment.rentalReservation).not.toBeNull()

    const releasableApartment = {
      _id: apartmentId,
      rentalReservation: {
        applicationId,
        reservedAt: new Date(),
        mode: 'application-accepted',
      },
    } as unknown as Apartment
    apartmentRepository.findOne.mockResolvedValue(releasableApartment)
    await expect(
      service.releaseRentalReservation(apartmentId.toHexString(), applicationId)
    ).resolves.toBe(true)
    expect(releasableApartment.rentalReservation).toBeNull()
  })

  it('does not release a reservation after a competing revision wins the CAS', async () => {
    const { service, apartmentRepository } = createService()
    const reservation = {
      applicationId,
      reservedAt: new Date(),
      mode: 'application-accepted' as const,
      revision: 3,
    }
    const apartment = {
      _id: apartmentId,
      rentalReservation: reservation,
    } as unknown as Apartment
    apartmentRepository.findOne.mockResolvedValue(apartment)
    apartmentRepository.update.mockResolvedValue({
      affected: 0,
      generatedMaps: [],
      raw: {},
    })

    await expect(
      service.releaseRentalReservation(
        apartmentId.toHexString(),
        applicationId,
        3
      )
    ).resolves.toBe(false)
    expect(apartment.rentalReservation).toBe(reservation)
    expect(apartmentRepository.save.mock.calls).toHaveLength(0)
  })
})
