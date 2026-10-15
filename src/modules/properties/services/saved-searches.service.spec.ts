import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { Apartment } from '../schemas/apartment.schema'
import { SavedSearchesService } from './saved-searches.service'
import type { SavedSearchRecord } from '../schemas/saved-search-record.schema'

type Row = Record<string, unknown> & { _id: ObjectId; kind: string }
type Where = Record<string, unknown>

/**
 * Kho lưu giả lập đúng một repository TypeORM của `SavedSearchRecord` (một collection,
 * hai kind). `find`/`findOne` lọc theo `where` thật, nên test bắt được truy vấn
 * thiếu `kind` (ví dụ đếm giới hạn lỡ đếm cả alert).
 */
type RecordStore = {
  rows: Row[]
  create: jest.Mock
  find: jest.Mock
  findOne: jest.Mock
  remove: jest.Mock
  save: jest.Mock
}

function createRecordStore(initial: Row[] = []): RecordStore {
  const rows: Row[] = [...initial]

  const matches = (row: Row, where: Where = {}): boolean =>
    Object.entries(where).every(([key, expected]) => {
      const actual = row[key]
      if (expected instanceof ObjectId) {
        return actual instanceof ObjectId && actual.equals(expected)
      }
      return actual === expected
    })

  const repository = {
    rows,
    create: jest.fn((value: Record<string, unknown>) => ({ ...value })),
    find: jest.fn((options: { where?: Where } = {}) =>
      Promise.resolve(rows.filter(row => matches(row, options.where)))
    ),
    findOne: jest.fn((options: { where?: Where } = {}) =>
      Promise.resolve(rows.find(row => matches(row, options.where)) ?? null)
    ),
    remove: jest.fn((row: Row) => {
      const index = rows.indexOf(row)
      if (index >= 0) rows.splice(index, 1)
      return Promise.resolve(row)
    }),
    save: jest.fn((value: Row | Row[]) => {
      const list = Array.isArray(value) ? value : [value]
      for (const row of list) {
        if (!row._id) row._id = new ObjectId()
        const index = rows.findIndex(r => r._id.equals(row._id))
        if (index >= 0) rows[index] = row
        else rows.push(row)
      }
      return Promise.resolve(value)
    }),
  }
  return repository
}

function createSearch(
  filters: Record<string, unknown>,
  overrides: Partial<Row> = {}
): Row {
  return {
    _id: new ObjectId(),
    kind: 'search',
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

function createAlert(overrides: Partial<Row> = {}): Row {
  return {
    _id: new ObjectId(),
    kind: 'alert',
    savedSearchId: new ObjectId().toString(),
    userId: 'tenant-1',
    apartmentId: 'apt-1',
    apartmentTitle: 'Two-bedroom apartment',
    triggerType: 'new_listing',
    matchReason: 'Tin đăng mới phù hợp với bộ lọc đã lưu',
    isRead: false,
    isDismissed: false,
    deduplicationKey: `key-${Math.random()}`,
    createdAt: new Date(),
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
  let store: RecordStore
  let records: RecordStore
  let service: SavedSearchesService

  function build(initial: Row[] = []): void {
    store = createRecordStore(initial)
    records = store
    service = new SavedSearchesService(
      store as unknown as Repository<SavedSearchRecord>
    )
  }

  beforeEach(() => {
    build()
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
    build([matching, nonMatching])

    await service.generateAlertsForApartment(createApartment(), 'new_listing')

    const alerts = records.rows.filter(row => row.kind === 'alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      savedSearchId: matching._id.toString(),
      apartmentId: expect.any(String) as unknown,
      triggerType: 'new_listing',
    })
  })

  it('does not create an alert when no active search matches', async () => {
    build([createSearch({ bedrooms: 3 })])

    await service.generateAlertsForApartment(
      createApartment({ bedrooms: 1 }),
      'new_listing'
    )

    expect(records.rows.filter(row => row.kind === 'alert')).toHaveLength(0)
    expect(records.save).not.toHaveBeenCalled()
  })

  it('creates a status-change alert when a matching listing becomes unavailable', async () => {
    build([createSearch({ city: 'Ho Chi Minh', bedrooms: 2 })])

    await service.generateAlertsForApartment(
      createApartment({ status: 'unavailable', isVerified: false }),
      'status_change',
      { previousValue: 'available', newValue: 'unavailable' }
    )

    expect(records.rows.filter(row => row.kind === 'alert')).toEqual([
      expect.objectContaining({
        kind: 'alert',
        triggerType: 'status_change',
        previousValue: 'available',
        newValue: 'unavailable',
      }),
    ])
  })

  it('deduplicates by saved search, apartment, and trigger type for four hours', async () => {
    const search = createSearch({ city: 'Ho Chi Minh' })
    const apartment = createApartment()
    const dedupKey = `${search._id.toString()}:${apartment._id.toString()}:price_change`
    build([
      search,
      createAlert({ deduplicationKey: dedupKey, createdAt: new Date() }),
    ])

    await service.generateAlertsForApartment(apartment, 'price_change', {
      previousValue: '14000000',
      newValue: '15000000',
    })

    expect(records.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind: 'alert', deduplicationKey: dedupKey },
      })
    )
    expect(records.rows.filter(row => row.kind === 'alert')).toHaveLength(1)
  })

  it('ignores a duplicate key that belongs to a saved search row, not an alert', async () => {
    const search = createSearch({ city: 'Ho Chi Minh' })
    const apartment = createApartment()
    const dedupKey = `${search._id.toString()}:${apartment._id.toString()}:price_change`
    build([
      search,
      createSearch({ city: 'Ha Noi' }, { deduplicationKey: dedupKey }),
    ])

    await service.generateAlertsForApartment(apartment, 'price_change', {
      previousValue: '14000000',
      newValue: '15000000',
    })

    expect(records.rows.filter(row => row.kind === 'alert')).toHaveLength(1)
  })

  it('considers only saved search rows when generating alerts', async () => {
    const search = createSearch({ city: 'Ho Chi Minh' })
    build([search, createAlert({ alertEnabled: true, filters: {} })])

    await service.generateAlertsForApartment(createApartment(), 'new_listing')

    expect(records.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { alertEnabled: true, kind: 'search' } })
    )
    expect(records.rows.filter(row => row.kind === 'alert')).toHaveLength(2)
  })

  it('disables alerts without deleting the saved search', async () => {
    const search = createSearch({})
    build([search])

    const result = await service.toggleAlert(
      search._id.toString(),
      search.userId as string,
      false
    )

    expect(result.alertEnabled).toBe(false)
    expect(result).not.toHaveProperty('kind')
    expect(records.remove).not.toHaveBeenCalled()
    expect(records.rows).toContain(search)
  })

  it('rejects creation after the per-user limit of saved searches is reached', async () => {
    build(Array.from({ length: 10 }, () => createSearch({})))

    await expect(
      service.createSavedSearch('tenant-1', {
        name: 'Another search',
        filters: {},
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('does not count alerts toward the saved search limit', async () => {
    build([
      ...Array.from({ length: 9 }, () => createSearch({})),
      ...Array.from({ length: 12 }, () => createAlert()),
    ])

    const created = await service.createSavedSearch('tenant-1', {
      name: 'Tenth search',
      filters: {},
    })

    expect(created).not.toHaveProperty('kind')
    expect(records.rows.filter(row => row.kind === 'search')).toHaveLength(10)
    expect(records.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'search', userId: 'tenant-1' })
    )
  })

  it('rejects toggling another user saved search', async () => {
    const other = createSearch({}, { userId: 'tenant-2' })
    build([other])
    const id = other._id.toString()

    await expect(service.toggleAlert(id, 'tenant-1', false)).rejects.toThrow(
      ForbiddenException
    )
  })

  it('does not treat an alert id as a saved search', async () => {
    const alert = createAlert({ userId: 'tenant-1' })
    build([alert])

    await expect(
      service.toggleAlert(alert._id.toString(), 'tenant-1', false)
    ).rejects.toThrow(NotFoundException)
    expect(alert.alertEnabled).toBeUndefined()
  })

  it('does not treat a saved search id as an alert', async () => {
    const search = createSearch({})
    build([search])

    await expect(
      service.markAlertRead(search._id.toString(), 'tenant-1')
    ).rejects.toThrow(NotFoundException)
    expect(search.isRead).toBeUndefined()
  })

  it('lists only saved searches for the saved-search endpoint', async () => {
    const mine = createSearch({})
    build([
      mine,
      createAlert({ userId: 'tenant-1' }),
      createSearch({}, { userId: 'tenant-2' }),
    ])

    const result = await service.getMySavedSearches('tenant-1', {
      page: 1,
      limit: 20,
    })

    expect(result.total).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).not.toHaveProperty('kind')
    expect(result.items[0]?._id).toEqual(mine._id)
  })

  it('lists only alerts for the alerts endpoint and strips kind', async () => {
    build([
      createSearch({}),
      createAlert({ userId: 'tenant-1', isRead: false }),
      createAlert({ userId: 'tenant-1', isRead: true }),
      createAlert({ userId: 'tenant-2' }),
    ])

    const all = await service.getAlerts('tenant-1', { page: 1, limit: 20 })
    const unread = await service.getAlerts('tenant-1', {
      page: 1,
      limit: 20,
      isRead: 'false',
    })

    expect(all.total).toBe(2)
    expect(all.items.every(item => !('kind' in item))).toBe(true)
    expect(unread.total).toBe(1)
    expect(unread.items[0]).toMatchObject({ isRead: false })
  })

  it('marks only the caller alerts as read', async () => {
    const search = createSearch({})
    build([
      search,
      createAlert({ userId: 'tenant-1' }),
      createAlert({ userId: 'tenant-2' }),
    ])

    await service.markAllAlertsRead('tenant-1')

    const alerts = records.rows.filter(row => row.kind === 'alert')
    expect(alerts.map(a => [a.userId, a.isRead])).toEqual([
      ['tenant-1', true],
      ['tenant-2', false],
    ])
    expect(search).not.toHaveProperty('isRead')
  })

  it('keeps alerts when a saved search is deleted', async () => {
    const search = createSearch({})
    const alert = createAlert({ savedSearchId: search._id.toString() })
    build([search, alert])

    await service.deleteSavedSearch(search._id.toString(), 'tenant-1')

    expect(records.rows).toEqual([alert])
  })
})
