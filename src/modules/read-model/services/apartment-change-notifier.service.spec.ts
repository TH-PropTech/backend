import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { ReadCacheService } from '../../health/services/read-cache.service'
import type { NotificationsService } from '../../notifications/services/notifications.service'
import type { User } from '../../users/schemas/user.schema'
import type { Apartment } from '../../properties/schemas/apartment.schema'
import { ApartmentCacheInvalidator } from './apartment-cache-invalidator.service'
import { ApartmentChangeNotifier } from './apartment-change-notifier.service'
import { ApartmentsService } from '../../properties/services/apartments.service'
import type { ProjectsService } from '../../properties/services/projects.service'
import type { SavedSearchesService } from '../../properties/services/saved-searches.service'

describe('ApartmentChangeNotifier', () => {
  it('calls every subscriber with the apartment id', async () => {
    const notifier = new ApartmentChangeNotifier()
    const first = vi.fn(() => Promise.resolve())
    const second = vi.fn(() => Promise.resolve())
    notifier.subscribe(first)
    notifier.subscribe(second)

    await notifier.changed('apt-1')

    expect(first).toHaveBeenCalledWith('apt-1')
    expect(second).toHaveBeenCalledWith('apt-1')
  })

  it('keeps notifying the others when one subscriber fails', async () => {
    const notifier = new ApartmentChangeNotifier()
    const healthy = vi.fn(() => Promise.resolve())
    notifier.subscribe(() => Promise.reject(new Error('boom')))
    notifier.subscribe(healthy)

    await expect(notifier.changed()).resolves.toBeUndefined()
    expect(healthy).toHaveBeenCalledTimes(1)
  })

  it('stops calling a subscriber after it unsubscribes', async () => {
    const notifier = new ApartmentChangeNotifier()
    const listener = vi.fn(() => Promise.resolve())
    const unsubscribe = notifier.subscribe(listener)

    unsubscribe()
    await notifier.changed()

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('ApartmentCacheInvalidator', () => {
  it('bumps the apartments cache version on every change', async () => {
    const notifier = new ApartmentChangeNotifier()
    const readCache = { invalidate: vi.fn(() => Promise.resolve()) }
    const invalidator = new ApartmentCacheInvalidator(
      notifier,
      readCache as unknown as ReadCacheService
    )
    invalidator.onModuleInit()

    await notifier.changed('apt-1')

    expect(readCache.invalidate).toHaveBeenCalledWith('apartments')

    invalidator.onModuleDestroy()
    await notifier.changed('apt-1')
    expect(readCache.invalidate).toHaveBeenCalledTimes(1)
  })
})

describe('ApartmentsService write side', () => {
  it('notifies the read side after a price change is saved', async () => {
    const id = new ObjectId()
    const apartment = {
      _id: id,
      landlordId: 'landlord-1',
      priceMonthly: 10_000_000,
    } as unknown as Apartment
    const apartmentRepository = {
      findOne: vi.fn(() => Promise.resolve(apartment)),
      save: vi.fn((value: Apartment) => Promise.resolve(value)),
    }
    const savedSearches = {
      generateAlertsForApartment: vi.fn(() => Promise.resolve()),
    }
    const notifier = { changed: vi.fn(() => Promise.resolve()) }
    const service = new ApartmentsService(
      apartmentRepository as unknown as Repository<Apartment>,
      {} as Repository<User>,
      {} as NotificationsService,
      {} as ProjectsService,
      savedSearches as unknown as SavedSearchesService,
      undefined,
      notifier as unknown as ApartmentChangeNotifier
    )

    await service.updatePrice(id.toString(), 12_000_000, 'landlord-1')

    expect(apartmentRepository.save).toHaveBeenCalledTimes(1)
    expect(notifier.changed).toHaveBeenCalledWith(id.toString())
  })

  it('does not notify when the save fails', async () => {
    const id = new ObjectId()
    const apartment = {
      _id: id,
      landlordId: 'landlord-1',
      priceMonthly: 10_000_000,
    } as unknown as Apartment
    const apartmentRepository = {
      findOne: vi.fn(() => Promise.resolve(apartment)),
      save: vi.fn(() => Promise.reject(new Error('db down'))),
    }
    const notifier = { changed: vi.fn(() => Promise.resolve()) }
    const service = new ApartmentsService(
      apartmentRepository as unknown as Repository<Apartment>,
      {} as Repository<User>,
      {} as NotificationsService,
      {} as ProjectsService,
      {} as SavedSearchesService,
      undefined,
      notifier as unknown as ApartmentChangeNotifier
    )

    await expect(
      service.updatePrice(id.toString(), 12_000_000, 'landlord-1')
    ).rejects.toThrow('db down')
    expect(notifier.changed).not.toHaveBeenCalled()
  })
})
