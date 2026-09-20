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
    apartmentRepository.save.mockResolvedValue(apartment)

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
    expect(apartmentRepository.save.mock.calls).toEqual([[apartment]])
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
})
