import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { Apartment } from '../apartments/schemas/apartment.schema'
import { SavedSearchesService } from './saved-searches.service'
import type { SavedSearch } from './schemas/saved-search.schema'
import type { SearchAlert } from './schemas/search-alert.schema'

type RepositoryMock<T> = {
  create: jest.Mock<T, [Partial<T>]>
  find: jest.Mock<Promise<T[]>, [unknown?]>
  findOne: jest.Mock<Promise<T | null>, [unknown?]>
  remove: jest.Mock<Promise<T>, [T]>
  save: jest.Mock<Promise<T | T[]>, [T | T[]]>
}

function createRepositoryMock<T>(): RepositoryMock<T> {
  return {
    create: jest.fn((value: Partial<T>) => value as T),
    find: jest.fn<Promise<T[]>, [unknown?]>(),
    findOne: jest.fn<Promise<T | null>, [unknown?]>(),
    remove: jest.fn<Promise<T>, [T]>(),
    save: jest.fn<Promise<T | T[]>, [T | T[]]>(value => Promise.resolve(value)),
  }
}

function createSearch(
  filters: SavedSearch['filters'],
  overrides: Partial<SavedSearch> = {}
): SavedSearch {
  return {
    _id: new ObjectId(),
    userId: 'tenant-1',
    name: 'District 1',
    filters,
    alertEnabled: true,
    alertFrequency: 'instant',
    matchCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function createApartment(overrides: Partial<Apartment> = {}): Apartment {
  return {
    _id: new ObjectId(),
    title: 'Two-bedroom apartment',
    buildingId: null,
    buildingName: null,
    projectId: null,
    projectName: null,
    category: 'apartment',
    description: 'Bright apartment',
    location: 'District 1',
    city: 'Ho Chi Minh',
    district: 'District 1',
    ward: 'Ben Nghe',
    street: 'Le Loi',
    address: '1 Le Loi',
    priceMonthly: 15_000_000,
    area: 70,
    bedrooms: 2,
    bathrooms: 2,
    direction: 'east',
    balconyDirection: 'east',
    furniture: 'full',
    moveInTime: 'immediate',
    electricity: 'official',
    water: 'official',
    internet: 'included',
    gallery: [],
    images360: [],
    vrUrl: '',
    amenities: ['parking', 'gym'],
    status: 'available',
    isVerified: true,
    landlordId: 'landlord-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('SavedSearchesService', () => {
  let savedSearchRepository: RepositoryMock<SavedSearch>
  let alertRepository: RepositoryMock<SearchAlert>
  let service: SavedSearchesService

  beforeEach(() => {
    savedSearchRepository = createRepositoryMock<SavedSearch>()
    alertRepository = createRepositoryMock<SearchAlert>()
    service = new SavedSearchesService(
      savedSearchRepository as unknown as Repository<SavedSearch>,
      alertRepository as unknown as Repository<SearchAlert>
    )
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('creates an alert only for searches whose filters match the apartment', async () => {
    const matching = createSearch({
      city: 'Ho Chi Minh',
      district: 'District 1',
      minPrice: 10,
      maxPrice: 20,
      minArea: 60,
      bedrooms: 2,
      amenities: ['parking'],
    })
    const nonMatching = createSearch(
      { city: 'Ha Noi' },
      { _id: new ObjectId(), name: 'Ha Noi' }
    )
    savedSearchRepository.find.mockResolvedValue([matching, nonMatching])
    alertRepository.findOne.mockResolvedValue(null)

    await service.generateAlertsForApartment(createApartment(), 'new_listing')

    expect(alertRepository.create).toHaveBeenCalledTimes(1)
    expect(alertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        savedSearchId: matching._id.toString(),
        apartmentId: expect.any(String) as unknown,
        triggerType: 'new_listing',
      })
    )
    expect(alertRepository.save).toHaveBeenCalledTimes(1)
  })

  it('does not create an alert when no active search matches', async () => {
    savedSearchRepository.find.mockResolvedValue([
      createSearch({ bedrooms: 3 }),
    ])

    await service.generateAlertsForApartment(
      createApartment({ bedrooms: 1 }),
      'new_listing'
    )

    expect(alertRepository.findOne).not.toHaveBeenCalled()
    expect(alertRepository.save).not.toHaveBeenCalled()
  })

  it('creates a status-change alert when a matching listing becomes unavailable', async () => {
    savedSearchRepository.find.mockResolvedValue([
      createSearch({ city: 'Ho Chi Minh', bedrooms: 2 }),
    ])
    alertRepository.findOne.mockResolvedValue(null)

    await service.generateAlertsForApartment(
      createApartment({ status: 'unavailable', isVerified: false }),
      'status_change',
      { previousValue: 'available', newValue: 'unavailable' }
    )

    expect(alertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'status_change',
        previousValue: 'available',
        newValue: 'unavailable',
      })
    )
  })

  it('deduplicates by saved search, apartment, and trigger type for four hours', async () => {
    const search = createSearch({ city: 'Ho Chi Minh' })
    const apartment = createApartment()
    savedSearchRepository.find.mockResolvedValue([search])
    alertRepository.findOne.mockResolvedValue({
      createdAt: new Date(),
    } as SearchAlert)

    await service.generateAlertsForApartment(apartment, 'price_change', {
      previousValue: '14000000',
      newValue: '15000000',
    })

    expect(alertRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deduplicationKey: `${search._id.toString()}:${apartment._id.toString()}:price_change`,
        },
      })
    )
    expect(alertRepository.save).not.toHaveBeenCalled()
  })

  it('disables alerts without deleting the saved search', async () => {
    const search = createSearch({})
    savedSearchRepository.findOne.mockResolvedValue(search)

    const result = await service.toggleAlert(
      search._id.toString(),
      search.userId,
      false
    )

    expect(result.alertEnabled).toBe(false)
    expect(savedSearchRepository.remove).not.toHaveBeenCalled()
    expect(savedSearchRepository.save).toHaveBeenCalledWith(search)
  })

  it('rejects creation after the per-user limit is reached', async () => {
    savedSearchRepository.find.mockResolvedValue(
      Array.from({ length: 10 }, () => createSearch({}))
    )

    await expect(
      service.createSavedSearch('tenant-1', {
        name: 'Another search',
        filters: {},
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('rejects toggling another user saved search', async () => {
    savedSearchRepository.findOne.mockResolvedValue(
      createSearch({}, { userId: 'tenant-2' })
    )

    await expect(
      service.toggleAlert(new ObjectId().toString(), 'tenant-1', false)
    ).rejects.toThrow(ForbiddenException)
  })
})
