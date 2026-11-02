import { BadRequestException } from '@nestjs/common'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { ApartmentsController } from './apartments.controller'
import type { ApartmentsService } from '../services/apartments.service'
import type { ApartmentMediaUploadService } from '../services/apartment-media-upload.service'
import type { ListingQualityService } from '../services/listing-quality.service'
import type { ApartmentsQueryService } from '../services/apartments-query.service'
import type { ConfigService } from '@nestjs/config'

function rolesOf(method: keyof ApartmentsController): string[] {
  const descriptor = Object.getOwnPropertyDescriptor(
    ApartmentsController.prototype,
    method
  )
  return Reflect.getMetadata(ROLES_KEY, descriptor?.value as object) as string[]
}

function buildController(): {
  controller: ApartmentsController
  apartments: {
    renew: jest.Mock
    update: jest.Mock
    findByLandlord: jest.Mock
    findAllForStaff: jest.Mock
    updateMedia: jest.Mock
  }
  upload: { uploadImages: jest.Mock }
  query: { findPublicPage: jest.Mock; findPublicById: jest.Mock }
} {
  const apartments = {
    renew: jest.fn(),
    update: jest.fn(),
    findByLandlord: jest.fn(),
    findAllForStaff: jest.fn(),
    updateMedia: jest.fn(),
  }
  const upload = { uploadImages: jest.fn() }
  const query = { findPublicPage: jest.fn(), findPublicById: jest.fn() }
  const config = { getOrThrow: jest.fn(() => 200) }
  const controller = new ApartmentsController(
    apartments as unknown as ApartmentsService,
    {} as ListingQualityService,
    upload as unknown as ApartmentMediaUploadService,
    query as unknown as ApartmentsQueryService,
    config as unknown as ConfigService
  )
  return { controller, apartments, upload, query }
}

describe('ApartmentsController listing posting', () => {
  it('lets landlord, staff and admin create, edit, renew and upload', () => {
    const expected = ['landlord', 'staff', 'admin']

    expect(rolesOf('create')).toEqual(expected)
    expect(rolesOf('update')).toEqual(expected)
    expect(rolesOf('renew')).toEqual(expected)
    expect(rolesOf('uploadImages')).toEqual(expected)
  })

  it('keeps approve, reject and pending queue staff/admin only', () => {
    expect(rolesOf('approve')).toEqual(['staff', 'admin'])
    expect(rolesOf('reject')).toEqual(['staff', 'admin'])
    expect(rolesOf('getPendingListings')).toEqual(['staff', 'admin'])
    expect(rolesOf('getRejectedListings')).toEqual(['staff', 'admin'])
    expect(rolesOf('getManageListings')).toEqual(['staff', 'admin'])
    expect(rolesOf('updateMedia')).toEqual(['staff', 'admin'])
  })

  it('keeps resubmit and my-listings landlord only', () => {
    expect(rolesOf('resubmit')).toEqual(['landlord'])
    expect(rolesOf('getMyListings')).toEqual(['landlord'])
  })

  describe('renew', () => {
    it.each([
      { user: { roles: ['landlord'] }, isStaff: false },
      { user: { roles: ['staff'] }, isStaff: true },
      { user: { roles: ['admin'] }, isStaff: true },
      { user: {}, isStaff: false },
    ])('passes isStaff=$isStaff for user $user', async ({ user, isStaff }) => {
      const { controller, apartments } = buildController()
      apartments.renew.mockResolvedValue({ _id: 'a-1' })

      await controller.renew('a-1', 'user-1', user).catch(() => undefined)

      expect(apartments.renew).toHaveBeenCalledWith('a-1', 'user-1', isStaff)
    })
  })

  describe('update', () => {
    it('forwards the caller id and staff flag to the service', async () => {
      const { controller, apartments } = buildController()
      apartments.update.mockResolvedValue({ _id: 'a-1' })

      await controller
        .update('a-1', { title: 'Tiêu đề mới cho căn hộ' }, 'user-1', {
          roles: ['staff'],
        })
        .catch(() => undefined)

      expect(apartments.update).toHaveBeenCalledWith(
        'a-1',
        { title: 'Tiêu đề mới cho căn hộ' },
        'user-1',
        true
      )
    })
  })

  describe('getMyListings', () => {
    const apartment = {
      _id: { toString: (): string => 'apt-1' },
      title: 'Căn hộ',
      priceMonthly: 15_000_000,
      status: 'expired',
      gallery: [],
    }

    it('returns the landlord shape with the raw VND price for format=landlord', async () => {
      const { controller, apartments } = buildController()
      apartments.findByLandlord.mockResolvedValue([apartment])

      const result = await controller.getMyListings('landlord-1', 'landlord')

      expect(result).toEqual([
        expect.objectContaining({
          id: 'apt-1',
          priceMonthly: 15_000_000,
          status: 'expired',
        }),
      ])
    })

    it('still returns the web shape by default', async () => {
      const { controller, apartments } = buildController()
      apartments.findByLandlord.mockResolvedValue([apartment])

      const result = await controller.getMyListings('landlord-1')

      expect(result[0]).toHaveProperty('priceNum')
      expect(result[0]).not.toHaveProperty('priceMonthly')
    })
  })

  describe('staff management shape', () => {
    const apartment = {
      _id: { toString: (): string => 'apt-1' },
      title: 'Căn hộ',
      priceMonthly: 15_000_000,
      status: 'pending',
      isVerified: false,
      landlordId: 'landlord-1',
      gallery: [],
    }

    it('lists every listing for staff with the raw VND price', async () => {
      const { controller, apartments } = buildController()
      apartments.findAllForStaff.mockResolvedValue([
        { ...apartment, landlord: null },
      ])

      const result = await controller.getManageListings()

      expect(result).toEqual([
        expect.objectContaining({
          id: 'apt-1',
          priceMonthly: 15_000_000,
          status: 'pending',
          landlord: null,
        }),
      ])
    })

    it('returns the staff shape after an edit', async () => {
      const { controller, apartments } = buildController()
      apartments.update.mockResolvedValue(apartment)

      const result = await controller.update(
        'apt-1',
        { title: 'Tiêu đề mới cho căn hộ' },
        'staff-1',
        { roles: ['staff'] }
      )

      expect(result).toMatchObject({ id: 'apt-1', priceMonthly: 15_000_000 })
    })

    it('returns the staff shape after a media update', async () => {
      const { controller, apartments } = buildController()
      apartments.updateMedia.mockResolvedValue(apartment)

      const result = await controller.updateMedia('apt-1', {
        vrUrl: 'https://my.matterport.com/show/?m=abc',
      })

      expect(apartments.updateMedia).toHaveBeenCalledWith('apt-1', {
        vrUrl: 'https://my.matterport.com/show/?m=abc',
      })
      expect(result).toMatchObject({ id: 'apt-1', priceMonthly: 15_000_000 })
    })
  })

  describe('uploadImages', () => {
    it('returns the storage urls', async () => {
      const { controller, upload } = buildController()
      upload.uploadImages.mockResolvedValue([
        'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/apartments/a.jpg',
      ])

      const result = await controller.uploadImages([
        { originalname: 'a.jpg' } as Express.Multer.File,
      ])

      expect(result).toEqual({
        urls: [
          'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com/apartments/a.jpg',
        ],
      })
    })

    it.each([[[]], [undefined as unknown as Express.Multer.File[]]])(
      'rejects an empty selection (%p)',
      async files => {
        const { controller, upload } = buildController()

        await expect(controller.uploadImages(files)).rejects.toBeInstanceOf(
          BadRequestException
        )
        expect(upload.uploadImages).not.toHaveBeenCalled()
      }
    )
  })
})

describe('ApartmentsController public listing', () => {
  const response = (): { setHeader: jest.Mock } => ({ setHeader: jest.fn() })

  it('returns the array and exposes the total in X-Total-Count', async () => {
    const { controller, query } = buildController()
    query.findPublicPage.mockResolvedValue({ items: [{ id: 'a' }], total: 345 })
    const res = response()

    const result = await controller.findAll(
      { city: 'hcm' },
      res as unknown as Parameters<typeof controller.findAll>[1]
    )

    expect(result).toEqual([{ id: 'a' }])
    expect(res.setHeader).toHaveBeenCalledWith('X-Total-Count', '345')
    expect(query.findPublicPage).toHaveBeenCalledWith({ city: 'hcm' }, 'web', {
      skip: 0,
      take: 200,
    })
  })

  it('maps page and limit to skip and take and keeps them out of the filters', async () => {
    const { controller, query } = buildController()
    query.findPublicPage.mockResolvedValue({ items: [], total: 0 })

    await controller.findAll(
      { page: '2', limit: '20', format: 'mobile' },
      response() as unknown as Parameters<typeof controller.findAll>[1]
    )

    expect(query.findPublicPage).toHaveBeenCalledWith({}, 'mobile', {
      skip: 20,
      take: 20,
    })
  })

  it('rejects a limit above the ceiling and a page below 1', async () => {
    const { controller } = buildController()
    const res = response() as unknown as Parameters<
      typeof controller.findAll
    >[1]

    await expect(
      controller.findAll({ limit: '201' }, res)
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.findAll({ page: '0' }, res)).rejects.toBeInstanceOf(
      BadRequestException
    )
    await expect(
      controller.findAll({ limit: 'abc' }, res)
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('serves the detail through the cached query side', async () => {
    const { controller, query } = buildController()
    query.findPublicById.mockResolvedValue({ id: 'x' })

    await expect(controller.findOne('x', 'mobile')).resolves.toEqual({
      id: 'x',
    })
    expect(query.findPublicById).toHaveBeenCalledWith('x', 'mobile')
  })
})
