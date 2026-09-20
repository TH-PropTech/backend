import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { ApartmentsService } from './apartments.service'
import type { Apartment } from './schemas/apartment.schema'
import type { CreateApartmentDto } from './dto/create-apartment.dto'
import type { UpdateApartmentDto } from './dto/update-apartment.dto'

const APARTMENT_ID = '507f1f77bcf86cd799439011'
const DAY_MS = 24 * 60 * 60 * 1000

function buildApartment(overrides: Partial<Apartment> = {}): Apartment {
  return {
    _id: new ObjectId(APARTMENT_ID),
    title: 'Căn hộ 2PN Vinhomes Grand Park',
    landlordId: 'landlord-1',
    status: 'pending',
    isVerified: false,
    pricingMode: 'legacy',
    pricingRevision: 0,
    priceMonthly: 15_000_000,
    ...overrides,
  } as unknown as Apartment
}

function buildCreateDto(
  overrides: Partial<CreateApartmentDto> = {}
): CreateApartmentDto {
  return {
    title: 'Căn hộ 2PN Vinhomes Grand Park',
    category: 'Căn hộ chung cư',
    description: 'Mô tả căn hộ đầy đủ tiện nghi, gần trung tâm thương mại.',
    location: 'Q9, TP.HCM',
    city: 'TP.HCM',
    district: 'Quận 9',
    ward: 'Long Thạnh Mỹ',
    street: 'Nguyễn Xiển',
    address: '12 Nguyễn Xiển',
    priceMonthly: 15_000_000,
    area: 65,
    bedrooms: 2,
    bathrooms: 2,
    direction: 'Đông',
    balconyDirection: 'Nam',
    furniture: 'Đầy đủ',
    moveInTime: 'Ngay',
    electricity: '3.500đ/kWh',
    water: '18.000đ/m3',
    internet: 'Miễn phí',
    ...overrides,
  }
}

function createContext(apartment: Apartment | null = buildApartment()): {
  service: ApartmentsService
  repository: {
    findOne: jest.Mock
    find: jest.Mock
    save: jest.Mock
    create: jest.Mock
  }
  userRepository: { find: jest.Mock }
  notifications: { createNotification: jest.Mock }
  projects: { findOrCreate: jest.Mock }
  buildings: { findOrCreate: jest.Mock }
  savedSearches: { generateAlertsForApartment: jest.Mock }
} {
  const repository = {
    findOne: jest.fn().mockResolvedValue(apartment),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(
      (value: Apartment): Promise<Apartment> => Promise.resolve(value)
    ),
    create: jest.fn((value: Partial<Apartment>) => ({
      _id: new ObjectId(APARTMENT_ID),
      ...value,
    })),
  }
  const userRepository = { find: jest.fn().mockResolvedValue([]) }
  const notifications = {
    createNotification: jest.fn().mockResolvedValue(undefined),
  }
  const projects = {
    findOrCreate: jest.fn().mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439012'),
      name: 'Vinhomes Grand Park',
    }),
  }
  const buildings = {
    findOrCreate: jest.fn().mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439013'),
      name: 'Block A',
    }),
  }
  const savedSearches = {
    generateAlertsForApartment: jest.fn().mockResolvedValue(undefined),
  }
  const service = new ApartmentsService(
    repository as never,
    userRepository as never,
    notifications as never,
    projects as never,
    buildings as never,
    savedSearches as never
  )
  return {
    service,
    repository,
    userRepository,
    notifications,
    projects,
    buildings,
    savedSearches,
  }
}

describe('ApartmentsService listing posting', () => {
  describe('create', () => {
    it('saves a pending unverified listing owned by the poster', async () => {
      const { service, repository } = createContext()
      const result = await service.create(buildCreateDto(), 'landlord-1')

      expect(result.status).toBe('pending')
      expect(result.isVerified).toBe(false)
      expect(result.landlordId).toBe('landlord-1')
      expect(result.submittedAt).toBeInstanceOf(Date)
      expect(repository.save).toHaveBeenCalledTimes(1)
    })

    it('find-or-creates project and building when only names are given', async () => {
      const { service, projects, buildings } = createContext()
      const result = await service.create(
        buildCreateDto({
          projectName: 'vinhomes grand park',
          buildingName: 'block a',
        }),
        'landlord-1'
      )

      expect(projects.findOrCreate).toHaveBeenCalledTimes(1)
      expect(buildings.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'block a',
          projectId: '507f1f77bcf86cd799439012',
        })
      )
      expect(result.projectId).toBe('507f1f77bcf86cd799439012')
      expect(result.projectName).toBe('Vinhomes Grand Park')
      expect(result.buildingId).toBe('507f1f77bcf86cd799439013')
    })

    it('starts with empty VR/360 media: only staff attach them later', async () => {
      const { service } = createContext()
      const result = await service.create(buildCreateDto(), 'landlord-1')

      expect(result.images360).toEqual([])
      expect(result.vrUrl).toBe('')
    })

    it('composes the location from the address parts when the client sends none', async () => {
      const { service } = createContext()
      const result = await service.create(
        buildCreateDto({ location: '' }),
        'landlord-1'
      )

      expect(result.location).toBe('Nguyễn Xiển, Long Thạnh Mỹ, Quận 9, TP.HCM')
    })

    it('keeps a location the client did send', async () => {
      const { service } = createContext()
      const result = await service.create(
        buildCreateDto({ location: 'Vinhomes GP, Q9' }),
        'landlord-1'
      )

      expect(result.location).toBe('Vinhomes GP, Q9')
    })

    it('stores empty strings for omitted optional details instead of undefined', async () => {
      const { service } = createContext()
      const dto = buildCreateDto()
      const {
        direction,
        balconyDirection,
        furniture,
        moveInTime,
        electricity,
        water,
        internet,
        ...required
      } = dto
      expect([
        direction,
        balconyDirection,
        furniture,
        moveInTime,
        electricity,
        water,
        internet,
      ]).toHaveLength(7)

      const result = await service.create(required, 'landlord-1')

      expect(result.direction).toBe('')
      expect(result.balconyDirection).toBe('')
      expect(result.furniture).toBe('')
      expect(result.moveInTime).toBe('')
      expect(result.electricity).toBe('')
      expect(result.water).toBe('')
      expect(result.internet).toBe('')
    })

    it('skips find-or-create when ids are already provided', async () => {
      const { service, projects, buildings } = createContext()
      await service.create(
        buildCreateDto({
          projectId: 'p-1',
          projectName: 'Existing',
          buildingId: 'b-1',
          buildingName: 'Existing block',
        }),
        'landlord-1'
      )

      expect(projects.findOrCreate).not.toHaveBeenCalled()
      expect(buildings.findOrCreate).not.toHaveBeenCalled()
    })

    it('notifies every staff member of the new listing', async () => {
      const { service, userRepository, notifications } = createContext()
      userRepository.find.mockResolvedValue([
        { _id: new ObjectId('507f1f77bcf86cd799439021') },
        { _id: new ObjectId('507f1f77bcf86cd799439022') },
      ])
      await service.create(buildCreateDto(), 'landlord-1')
      await new Promise(resolve => setImmediate(resolve))

      expect(notifications.createNotification).toHaveBeenCalledTimes(2)
      expect(notifications.createNotification).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439021',
        'Bài đăng mới chờ duyệt',
        expect.any(String),
        'new-listing',
        { apartmentId: APARTMENT_ID }
      )
    })
  })

  describe('approve', () => {
    it('sets available, verified and expiry 30 days out', async () => {
      const { service } = createContext()
      const before = Date.now()
      const result = await service.approve(APARTMENT_ID, 'staff-1')

      expect(result.status).toBe('available')
      expect(result.isVerified).toBe(true)
      expect(result.approvedBy).toBe('staff-1')
      expect(result.rejectedReason).toBeNull()
      const expiresMs = (result.expiresAt as Date).getTime()
      expect(expiresMs).toBeGreaterThanOrEqual(before + 30 * DAY_MS)
      expect(expiresMs).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS)
    })

    it('notifies the landlord', async () => {
      const { service, notifications } = createContext()
      await service.approve(APARTMENT_ID, 'staff-1')

      expect(notifications.createNotification).toHaveBeenCalledWith(
        'landlord-1',
        expect.any(String),
        expect.any(String),
        'listing-approved',
        { apartmentId: APARTMENT_ID }
      )
    })

    it.each(['available', 'rejected', 'expired', 'unavailable'] as const)(
      'refuses to approve a listing in %s status',
      async status => {
        const { service, repository } = createContext(
          buildApartment({ status })
        )

        await expect(
          service.approve(APARTMENT_ID, 'staff-1')
        ).rejects.toBeInstanceOf(BadRequestException)
        expect(repository.save).not.toHaveBeenCalled()
      }
    )

    it('throws NotFound when the listing does not exist', async () => {
      const { service } = createContext(null)

      await expect(
        service.approve(APARTMENT_ID, 'staff-1')
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('reject', () => {
    it('stores the reason, unverifies and notifies the landlord', async () => {
      const { service, notifications } = createContext()
      const result = await service.reject(APARTMENT_ID, 'Ảnh không rõ ràng')

      expect(result.status).toBe('rejected')
      expect(result.isVerified).toBe(false)
      expect(result.rejectedReason).toBe('Ảnh không rõ ràng')
      expect(notifications.createNotification).toHaveBeenCalledWith(
        'landlord-1',
        expect.any(String),
        expect.stringContaining('Ảnh không rõ ràng'),
        'listing-rejected',
        expect.objectContaining({ rejectedReason: 'Ảnh không rõ ràng' })
      )
    })

    it.each(['available', 'rejected', 'expired'] as const)(
      'refuses to reject a listing in %s status',
      async status => {
        const { service, repository } = createContext(
          buildApartment({ status })
        )

        await expect(
          service.reject(APARTMENT_ID, 'Lý do đủ dài')
        ).rejects.toBeInstanceOf(BadRequestException)
        expect(repository.save).not.toHaveBeenCalled()
      }
    )

    it('throws NotFound when the listing does not exist', async () => {
      const { service } = createContext(null)

      await expect(
        service.reject(APARTMENT_ID, 'Lý do đủ dài')
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('resubmit', () => {
    it('moves a rejected listing back to pending and clears the reason', async () => {
      const { service } = createContext(
        buildApartment({ status: 'rejected', rejectedReason: 'Sai giá' })
      )
      const result = await service.resubmit(
        APARTMENT_ID,
        buildCreateDto(),
        'landlord-1'
      )

      expect(result.status).toBe('pending')
      expect(result.rejectedReason).toBeNull()
      expect(result.submittedAt).toBeInstanceOf(Date)
    })

    it('keeps the VR/360 media staff attached when the landlord resubmits', async () => {
      const { service } = createContext(
        buildApartment({
          status: 'rejected',
          images360: ['https://res.cloudinary.com/x/360.jpg'],
          vrUrl: 'https://my.matterport.com/show/?m=abc',
        })
      )
      const result = await service.resubmit(
        APARTMENT_ID,
        buildCreateDto(),
        'landlord-1'
      )

      expect(result.images360).toEqual(['https://res.cloudinary.com/x/360.jpg'])
      expect(result.vrUrl).toBe('https://my.matterport.com/show/?m=abc')
    })

    it('keeps the VR/360 media staff attached when the landlord resubmits', async () => {
      const { service } = createContext(
        buildApartment({
          status: 'rejected',
          images360: ['https://res.cloudinary.com/x/360.jpg'],
          vrUrl: 'https://my.matterport.com/show/?m=abc',
        })
      )
      const result = await service.resubmit(
        APARTMENT_ID,
        buildCreateDto(),
        'landlord-1'
      )

      expect(result.images360).toEqual(['https://res.cloudinary.com/x/360.jpg'])
      expect(result.vrUrl).toBe('https://my.matterport.com/show/?m=abc')
    })

    it('rejects non-owners and non-rejected listings', async () => {
      const rejected = createContext(buildApartment({ status: 'rejected' }))
      await expect(
        rejected.service.resubmit(APARTMENT_ID, buildCreateDto(), 'intruder')
      ).rejects.toBeInstanceOf(ForbiddenException)

      const pending = createContext(buildApartment({ status: 'pending' }))
      await expect(
        pending.service.resubmit(APARTMENT_ID, buildCreateDto(), 'landlord-1')
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('renew', () => {
    it('extends an available listing by 30 days for the owner', async () => {
      const { service } = createContext(buildApartment({ status: 'available' }))
      const before = Date.now()
      const result = await service.renew(APARTMENT_ID, 'landlord-1')

      expect(result.status).toBe('available')
      expect((result.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(
        before + 30 * DAY_MS
      )
    })

    it('reactivates an expired listing', async () => {
      const { service } = createContext(buildApartment({ status: 'expired' }))
      const result = await service.renew(APARTMENT_ID, 'landlord-1')

      expect(result.status).toBe('available')
    })

    it('lets staff renew any listing without ownership', async () => {
      const { service } = createContext(buildApartment({ status: 'expired' }))
      const result = await service.renew(APARTMENT_ID, 'staff-9', true)

      expect(result.status).toBe('available')
    })

    it('rejects a non-owner landlord and non-renewable statuses', async () => {
      const owned = createContext(buildApartment({ status: 'available' }))
      await expect(
        owned.service.renew(APARTMENT_ID, 'intruder')
      ).rejects.toBeInstanceOf(ForbiddenException)

      const pending = createContext(buildApartment({ status: 'pending' }))
      await expect(
        pending.service.renew(APARTMENT_ID, 'landlord-1')
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('throws NotFound when the listing does not exist', async () => {
      const { service } = createContext(null)

      await expect(
        service.renew(APARTMENT_ID, 'landlord-1')
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('update', () => {
    const dto: UpdateApartmentDto = {
      title: 'Tiêu đề mới cho căn hộ',
      area: 70,
    }

    it.each(['pending', 'rejected'] as const)(
      'lets the owner edit a %s listing and keeps its status',
      async status => {
        const { service } = createContext(buildApartment({ status }))
        const result = await service.update(
          APARTMENT_ID,
          dto,
          'landlord-1',
          false
        )

        expect(result.title).toBe('Tiêu đề mới cho căn hộ')
        expect(result.area).toBe(70)
        expect(result.status).toBe(status)
      }
    )

    it('lets staff edit any pending listing', async () => {
      const { service } = createContext()
      const result = await service.update(APARTMENT_ID, dto, 'staff-1', true)

      expect(result.title).toBe('Tiêu đề mới cho căn hộ')
    })

    it('does not overwrite fields that were not provided', async () => {
      const { service } = createContext(
        buildApartment({ status: 'pending', priceMonthly: 15_000_000 })
      )
      const result = await service.update(
        APARTMENT_ID,
        dto,
        'landlord-1',
        false
      )

      expect(result.priceMonthly).toBe(15_000_000)
    })

    it.each([
      'pending',
      'rejected',
      'available',
      'expired',
      'unavailable',
    ] as const)(
      'lets staff edit a %s listing without changing status or verification',
      async status => {
        const { service } = createContext(
          buildApartment({ status, isVerified: status === 'available' })
        )
        const result = await service.update(APARTMENT_ID, dto, 'staff-1', true)

        expect(result.title).toBe('Tiêu đề mới cho căn hộ')
        expect(result.status).toBe(status)
        expect(result.isVerified).toBe(status === 'available')
      }
    )

    it('does not reset approval data when staff edit an approved listing', async () => {
      const approvedAt = new Date('2026-09-01T00:00:00.000Z')
      const expiresAt = new Date('2026-10-01T00:00:00.000Z')
      const { service } = createContext(
        buildApartment({
          status: 'available',
          isVerified: true,
          approvedAt,
          approvedBy: 'staff-9',
          expiresAt,
        })
      )
      const result = await service.update(APARTMENT_ID, dto, 'staff-1', true)

      expect(result.approvedAt).toBe(approvedAt)
      expect(result.approvedBy).toBe('staff-9')
      expect(result.expiresAt).toBe(expiresAt)
    })

    it('recomposes the location when an address part changes and no location is sent', async () => {
      const { service } = createContext(
        buildApartment({
          status: 'pending',
          street: 'Nguyễn Xiển',
          ward: 'Long Thạnh Mỹ',
          district: 'Quận 9',
          city: 'TP.HCM',
          location: 'Nguyễn Xiển, Long Thạnh Mỹ, Quận 9, TP.HCM',
        })
      )
      const result = await service.update(
        APARTMENT_ID,
        { street: 'Lê Văn Việt' },
        'landlord-1',
        false
      )

      expect(result.location).toBe('Lê Văn Việt, Long Thạnh Mỹ, Quận 9, TP.HCM')
    })

    it('keeps an explicit location and leaves it alone when no address part changes', async () => {
      const explicit = createContext(
        buildApartment({ status: 'pending', street: 'A', location: 'old' })
      )
      const withLocation = await explicit.service.update(
        APARTMENT_ID,
        { street: 'B', location: 'Vinhomes GP, Q9' },
        'landlord-1',
        false
      )
      expect(withLocation.location).toBe('Vinhomes GP, Q9')

      const untouched = createContext(
        buildApartment({ status: 'pending', street: 'A', location: 'custom' })
      )
      const result = await untouched.service.update(
        APARTMENT_ID,
        { title: 'Tiêu đề mới cho căn hộ' },
        'landlord-1',
        false
      )
      expect(result.location).toBe('custom')
    })

    it('refuses a bare price edit on a package-priced listing', async () => {
      const { service, repository } = createContext(
        buildApartment({ status: 'pending', pricingMode: 'packages' })
      )

      await expect(
        service.update(
          APARTMENT_ID,
          { priceMonthly: 9_000_000 },
          'landlord-1',
          false
        )
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(repository.save).not.toHaveBeenCalled()
    })

    it('rejects non-owners', async () => {
      const { service, repository } = createContext()

      await expect(
        service.update(APARTMENT_ID, dto, 'intruder', false)
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(repository.save).not.toHaveBeenCalled()
    })

    it.each(['available', 'expired', 'unavailable'] as const)(
      'refuses to edit a %s listing',
      async status => {
        const { service } = createContext(buildApartment({ status }))

        await expect(
          service.update(APARTMENT_ID, dto, 'landlord-1', false)
        ).rejects.toBeInstanceOf(BadRequestException)
      }
    )

    it('throws NotFound when the listing does not exist', async () => {
      const { service } = createContext(null)

      await expect(
        service.update(APARTMENT_ID, dto, 'landlord-1', false)
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('findAllForStaff', () => {
    const landlordOne = '507f1f77bcf86cd799439031'
    const landlordTwo = '507f1f77bcf86cd799439032'

    it('returns every status and attaches each landlord with a single user query', async () => {
      const { service, repository, userRepository } = createContext()
      repository.find.mockResolvedValue([
        buildApartment({ status: 'pending', landlordId: landlordOne }),
        buildApartment({ status: 'available', landlordId: landlordTwo }),
        buildApartment({ status: 'expired', landlordId: landlordOne }),
      ])
      userRepository.find.mockResolvedValue([
        { _id: new ObjectId(landlordOne), fullName: 'Nguyễn Văn A' },
      ])

      const result = await service.findAllForStaff()

      expect(repository.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      })
      expect(userRepository.find).toHaveBeenCalledTimes(1)
      expect(result.map(item => item.status)).toEqual([
        'pending',
        'available',
        'expired',
      ])
      expect(result[0]?.landlord?.fullName).toBe('Nguyễn Văn A')
      expect(result[1]?.landlord).toBeNull()
      expect(result[2]?.landlord?.fullName).toBe('Nguyễn Văn A')
    })

    it('does not query users when there are no listings', async () => {
      const { service, userRepository } = createContext()

      await expect(service.findAllForStaff()).resolves.toEqual([])
      expect(userRepository.find).not.toHaveBeenCalled()
    })

    it('ignores landlord ids that are not valid ObjectIds', async () => {
      const { service, repository, userRepository } = createContext()
      repository.find.mockResolvedValue([
        buildApartment({ landlordId: 'not-an-object-id' }),
      ])

      const result = await service.findAllForStaff()

      expect(userRepository.find).not.toHaveBeenCalled()
      expect(result[0]?.landlord).toBeNull()
    })
  })

  describe('findPending / findRejected', () => {
    it('queries pending listings oldest first', async () => {
      const { service, repository } = createContext()
      await service.findPending()

      expect(repository.find).toHaveBeenCalledWith({
        where: { status: 'pending' },
        order: { createdAt: 'ASC' },
      })
    })

    it('queries rejected listings newest first', async () => {
      const { service, repository } = createContext()
      const rejected = [buildApartment({ status: 'rejected' })]
      repository.find.mockResolvedValue(rejected)

      await expect(service.findRejected()).resolves.toBe(rejected)
      expect(repository.find).toHaveBeenCalledWith({
        where: { status: 'rejected' },
        order: { createdAt: 'DESC' },
      })
    })
  })

  describe('checkExpiration', () => {
    it('expires overdue listings and notifies each landlord', async () => {
      const { service, repository, notifications } = createContext()
      repository.find.mockResolvedValue([
        buildApartment({ status: 'available', landlordId: 'l-1' }),
        buildApartment({ status: 'available', landlordId: 'l-2' }),
      ])
      await service.checkExpiration()

      expect(repository.save).toHaveBeenCalledTimes(2)
      expect(notifications.createNotification).toHaveBeenCalledWith(
        'l-1',
        'Bài đăng đã hết hạn',
        expect.any(String),
        'listing-expired',
        { apartmentId: APARTMENT_ID }
      )
      expect(notifications.createNotification).toHaveBeenCalledTimes(2)
    })

    it('does nothing when no listing is overdue', async () => {
      const { service, repository, notifications } = createContext()
      await service.checkExpiration()

      expect(repository.save).not.toHaveBeenCalled()
      expect(notifications.createNotification).not.toHaveBeenCalled()
    })
  })

  describe('remindExpiringSoon', () => {
    it('notifies landlords whose listing expires within 3 days', async () => {
      const { service, repository, notifications } = createContext()
      repository.find.mockResolvedValue([
        buildApartment({ status: 'available', landlordId: 'l-1' }),
      ])
      await service.remindExpiringSoon()

      expect(notifications.createNotification).toHaveBeenCalledWith(
        'l-1',
        'Bài đăng sắp hết hạn',
        expect.stringContaining('3 ngày'),
        'listing-expiring',
        { apartmentId: APARTMENT_ID }
      )
    })

    it('does nothing when nothing is expiring', async () => {
      const { service, notifications } = createContext()
      await service.remindExpiringSoon()

      expect(notifications.createNotification).not.toHaveBeenCalled()
    })
  })
})
