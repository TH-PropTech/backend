import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { ApartmentsService } from './apartments.service'
import type { Apartment } from '../schemas/apartment.schema'
import type { User } from '../../users/schemas/user.schema'
import type { NotificationsService } from '../../notifications/services/notifications.service'
import type { ProjectsService } from './projects.service'
import type { BuildingsService } from './buildings.service'
import type { SavedSearchesService } from './saved-searches.service'

function createApartment(overrides: Partial<Apartment> = {}): Apartment {
  return {
    _id: new ObjectId(),
    title: 'Apartment awaiting approval',
    status: 'pending',
    isVerified: false,
    landlordId: 'landlord-1',
    amenities: [],
    gallery: [],
    images360: [],
    ...overrides,
  } as Apartment
}

describe('ApartmentsService saved-search integration', () => {
  const apartmentRepository = {
    findOne: jest.fn<Promise<Apartment | null>, [unknown]>(),
    save: jest.fn<Promise<Apartment>, [Apartment]>(apartment =>
      Promise.resolve(apartment)
    ),
  }
  const userRepository = {}
  const notificationsService = {
    createNotification: jest.fn().mockResolvedValue(undefined),
  }
  const projectsService = {}
  const buildingsService = {}
  const savedSearchesService = {
    generateAlertsForApartment: jest.fn().mockResolvedValue(undefined),
  }

  let service: ApartmentsService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new ApartmentsService(
      apartmentRepository as unknown as Repository<Apartment>,
      userRepository as unknown as Repository<User>,
      notificationsService as unknown as NotificationsService,
      projectsService as unknown as ProjectsService,
      buildingsService as unknown as BuildingsService,
      savedSearchesService as unknown as SavedSearchesService
    )
  })

  it('publishes a new-listing alert event only after staff approval', async () => {
    const apartment = createApartment()
    apartmentRepository.findOne.mockResolvedValue(apartment)

    const approved = await service.approve(apartment._id.toString(), 'staff-1')

    expect(approved.status).toBe('available')
    expect(
      savedSearchesService.generateAlertsForApartment
    ).toHaveBeenCalledWith(approved, 'new_listing', {})
  })

  it('publishes a status-change event after a listing availability update', async () => {
    const apartment = createApartment({
      status: 'unavailable',
      isVerified: false,
    })
    apartmentRepository.findOne.mockResolvedValue(apartment)

    const updated = await service.updateStatus(
      apartment._id.toString(),
      'available',
      true
    )

    expect(
      savedSearchesService.generateAlertsForApartment
    ).toHaveBeenCalledWith(updated, 'status_change', {
      previousValue: 'unavailable',
      newValue: 'available',
    })
  })

  it('publishes a price-change event with the old and new monthly rent', async () => {
    const apartment = createApartment({
      status: 'available',
      isVerified: true,
      priceMonthly: 15_000_000,
    })
    apartmentRepository.findOne.mockResolvedValue(apartment)

    const updated = await service.updatePrice(
      apartment._id.toString(),
      13_500_000,
      'landlord-1'
    )

    expect(updated.priceMonthly).toBe(13_500_000)
    expect(
      savedSearchesService.generateAlertsForApartment
    ).toHaveBeenCalledWith(updated, 'price_change', {
      previousValue: '15000000',
      newValue: '13500000',
    })
  })
})
