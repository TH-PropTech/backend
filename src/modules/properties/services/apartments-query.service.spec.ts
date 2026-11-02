import { NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { MongoRepository, Repository } from 'typeorm'
import type { ReadCacheService } from '../../health/services/read-cache.service'
import type { User } from '../../users/schemas/user.schema'
import type { Apartment } from '../schemas/apartment.schema'
import { ApartmentsQueryService } from './apartments-query.service'

function apartment(id: ObjectId, landlordId: string): Apartment {
  return {
    _id: id,
    title: 'Căn hộ test',
    landlordId,
    status: 'available',
    priceMonthly: 12000000,
    area: 50,
    bedrooms: 2,
    bathrooms: 1,
    gallery: [],
    images360: [],
    amenities: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  } as unknown as Apartment
}

function build(): {
  service: ApartmentsQueryService
  apartmentRepository: {
    find: ReturnType<typeof vi.fn>
    countDocuments: ReturnType<typeof vi.fn>
    findOne: ReturnType<typeof vi.fn>
  }
  userRepository: { find: ReturnType<typeof vi.fn> }
  readCache: { wrap: ReturnType<typeof vi.fn> }
} {
  const apartmentRepository = {
    find: vi.fn(),
    countDocuments: vi.fn(),
    findOne: vi.fn(),
  }
  const userRepository = { find: vi.fn().mockResolvedValue([]) }
  const readCache = {
    wrap: vi.fn(
      async (
        _namespace: string,
        _parts: Record<string, unknown>,
        loader: () => Promise<unknown>
      ) => loader()
    ),
  }
  const service = new ApartmentsQueryService(
    apartmentRepository as unknown as MongoRepository<Apartment>,
    userRepository as unknown as Repository<User>,
    readCache as unknown as ReadCacheService
  )
  return { service, apartmentRepository, userRepository, readCache }
}

describe('ApartmentsQueryService', () => {
  it('pages the public listing with skip, take and a matching count', async () => {
    const { service, apartmentRepository } = build()
    const id = new ObjectId()
    apartmentRepository.find.mockResolvedValue([
      apartment(id, new ObjectId().toString()),
    ])
    apartmentRepository.countDocuments.mockResolvedValue(345)

    const result = await service.findPublicPage({ city: 'hcm' }, 'web', {
      skip: 40,
      take: 20,
    })

    expect(result.total).toBe(345)
    expect(result.items).toHaveLength(1)
    expect(apartmentRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40,
        take: 20,
        order: { createdAt: 'DESC' },
      })
    )
    const firstCall = apartmentRepository.find.mock.calls[0] as [
      { where: { status: unknown } },
    ]
    const { where } = firstCall[0]
    expect(where.status).toEqual({ $in: ['available', 'rented'] })
    expect(apartmentRepository.countDocuments).toHaveBeenCalledWith(where)
  })

  it('keys the list cache by filters, format and page', async () => {
    const { service, apartmentRepository, readCache } = build()
    apartmentRepository.find.mockResolvedValue([])
    apartmentRepository.countDocuments.mockResolvedValue(0)

    await service.findPublicPage({ city: 'hn' }, 'mobile', {
      skip: 0,
      take: 200,
    })

    expect(readCache.wrap).toHaveBeenCalledWith(
      'apartments',
      {
        kind: 'list',
        filters: { city: 'hn' },
        format: 'mobile',
        skip: 0,
        take: 200,
      },
      expect.any(Function)
    )
  })

  it('keeps the old title lookup but only loads _id and title', async () => {
    const { service, apartmentRepository } = build()
    const id = new ObjectId()
    apartmentRepository.find.mockResolvedValue([
      { _id: new ObjectId(), title: 'Khác hẳn' },
      { _id: id, title: 'Căn hộ Sunrise' },
    ])
    apartmentRepository.findOne.mockResolvedValue(
      apartment(id, new ObjectId().toString())
    )

    await expect(
      service.findPublicById('căn hộ sunrise', 'web')
    ).resolves.toBeDefined()

    expect(apartmentRepository.find).toHaveBeenCalledWith({
      select: ['_id', 'title'],
    })
    expect(apartmentRepository.findOne).toHaveBeenCalledWith({
      where: { _id: id },
    })
  })

  it('answers 404 when neither the id nor any title matches', async () => {
    const { service, apartmentRepository } = build()
    apartmentRepository.findOne.mockResolvedValue(null)
    apartmentRepository.find.mockResolvedValue([
      { _id: new ObjectId(), title: 'Căn hộ A' },
    ])

    await expect(
      service.findPublicById(new ObjectId().toString(), 'web')
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.findPublicById('zzz-no-match', 'web')
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('turns an unexpected database error into the old 404', async () => {
    const { service, apartmentRepository } = build()
    apartmentRepository.findOne.mockRejectedValue(new Error('db down'))

    await expect(
      service.findPublicById(new ObjectId().toString(), 'web')
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('returns the detail with the landlord attached', async () => {
    const { service, apartmentRepository, userRepository } = build()
    const id = new ObjectId()
    const landlordId = new ObjectId()
    apartmentRepository.findOne.mockResolvedValue(
      apartment(id, landlordId.toString())
    )

    const result = await service.findPublicById(id.toString(), 'web')

    expect(result).toBeDefined()
    expect(userRepository.find).toHaveBeenCalledTimes(1)
  })
})
