import { BadRequestException, NotFoundException } from '@nestjs/common'

import { ApartmentsService } from './apartments.service'
import type { Apartment } from '../schemas/apartment.schema'

interface ApartmentRepositoryMock {
  findOne: jest.Mock
  save: jest.Mock
}

function createService(repository: ApartmentRepositoryMock): ApartmentsService {
  const service = Object.create(
    ApartmentsService.prototype
  ) as ApartmentsService
  Reflect.set(service, 'apartmentRepository', repository)
  return service
}

describe('ApartmentsService.updateMedia', () => {
  const apartmentId = '507f1f77bcf86cd799439011'

  it('replaces normal images without changing 360 images', async () => {
    const apartment = {
      gallery: ['/old.jpg'],
      images360: ['/keep-360.jpg'],
    } as Apartment
    const repository = {
      findOne: jest.fn().mockResolvedValue(apartment),
      save: jest.fn().mockImplementation(value => Promise.resolve(value)),
    }
    const service = createService(repository)

    const updated = await service.updateMedia(apartmentId, {
      gallery: ['/new.jpg'],
    })

    expect(updated.gallery).toEqual(['/new.jpg'])
    expect(updated.images360).toEqual(['/keep-360.jpg'])
  })

  it('replaces 360 images without changing normal images', async () => {
    const apartment = {
      gallery: ['/keep.jpg'],
      images360: ['/old-360.jpg'],
    } as Apartment
    const repository = {
      findOne: jest.fn().mockResolvedValue(apartment),
      save: jest.fn().mockImplementation(value => Promise.resolve(value)),
    }
    const service = createService(repository)

    const updated = await service.updateMedia(apartmentId, {
      images360: ['/new-360.jpg'],
    })

    expect(updated.gallery).toEqual(['/keep.jpg'])
    expect(updated.images360).toEqual(['/new-360.jpg'])
  })

  it('sets the VR tour link staff captured without touching images', async () => {
    const apartment = {
      gallery: ['/keep.jpg'],
      images360: ['/keep-360.jpg'],
      vrUrl: '',
    } as Apartment
    const repository = {
      findOne: jest.fn().mockResolvedValue(apartment),
      save: jest.fn().mockImplementation(value => Promise.resolve(value)),
    }
    const service = createService(repository)

    const updated = await service.updateMedia(apartmentId, {
      vrUrl: 'https://my.matterport.com/show/?m=abc',
    })

    expect(updated.vrUrl).toBe('https://my.matterport.com/show/?m=abc')
    expect(updated.gallery).toEqual(['/keep.jpg'])
    expect(updated.images360).toEqual(['/keep-360.jpg'])
  })

  it('rejects an empty media update', async () => {
    const repository = {
      findOne: jest.fn(),
      save: jest.fn(),
    }
    const service = createService(repository)

    await expect(service.updateMedia(apartmentId, {})).rejects.toBeInstanceOf(
      BadRequestException
    )
  })

  it('reports a missing apartment', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    }
    const service = createService(repository)

    await expect(
      service.updateMedia(apartmentId, { gallery: [] })
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
