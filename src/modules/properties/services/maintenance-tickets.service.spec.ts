import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { getMetadataArgsStorage } from 'typeorm'
import { ApartmentResponseMapper } from '../mappers/apartment-response.mapper'
import {
  Apartment,
  MAX_MAINTENANCE_TICKETS,
  MAX_MAINTENANCE_TICKET_IMAGES,
} from '../schemas/apartment.schema'
import { MaintenanceTicketsService } from './maintenance-tickets.service'

const APARTMENT_ID = '507f1f77bcf86cd799439011'

function build(opts: { found?: boolean; matched?: number } = {}): {
  service: MaintenanceTicketsService
  repo: Record<'findOne' | 'updateOne' | 'save' | 'aggregate', jest.Mock>
} {
  const repo = {
    findOne: jest.fn().mockResolvedValue(
      opts.found === false
        ? null
        : {
            _id: new ObjectId(APARTMENT_ID),
            title: 'Căn A',
          }
    ),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: opts.matched ?? 1 }),
    save: jest.fn(),
    aggregate: jest.fn(),
  }
  return { service: new MaintenanceTicketsService(repo as never), repo }
}

describe('MaintenanceTicketsService', () => {
  it('pushes the ticket atomically with a cap and never saves the whole apartment', async () => {
    const { service, repo } = build()

    const entry = await service.create(APARTMENT_ID, {
      tenantId: 'u1',
      description: 'Vòi nước rò',
      images: ['a.jpg'],
    })

    expect(entry).toMatchObject({
      tenantId: 'u1',
      propertyTitle: 'Căn A',
      status: 'pending',
      resolvedAt: null,
      images: ['a.jpg'],
    })
    expect(repo.save).not.toHaveBeenCalled()
    const [filter, update] = repo.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $push: { maintenanceTickets: unknown } },
    ]
    expect(String(filter._id)).toBe(APARTMENT_ID)
    expect(filter[`maintenanceTickets.${MAX_MAINTENANCE_TICKETS - 1}`]).toEqual(
      { $exists: false }
    )
    expect(update.$push.maintenanceTickets).toBe(entry)
  })

  it('answers 409 when the apartment already holds the maximum tickets', async () => {
    const { service } = build({ matched: 0 })
    await expect(
      service.create(APARTMENT_ID, { tenantId: 'u1', description: 'x' })
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects unknown apartment, bad id and too many images', async () => {
    await expect(
      build({ found: false }).service.create(APARTMENT_ID, {
        tenantId: 'u1',
        description: 'x',
      })
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      build().service.create('not-an-id', { tenantId: 'u1', description: 'x' })
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      build().service.create(APARTMENT_ID, {
        tenantId: 'u1',
        description: 'x',
        images: Array.from(
          { length: MAX_MAINTENANCE_TICKET_IMAGES + 1 },
          (_, i) => `${i}.jpg`
        ),
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('lists tickets from a raw projection', async () => {
    const { service, repo } = build()
    const tickets = [{ _id: new ObjectId(), description: 'x' }]
    repo.aggregate.mockReturnValue({
      toArray: () => Promise.resolve([{ maintenanceTickets: tickets }]),
    })
    await expect(service.list(APARTMENT_ID)).resolves.toEqual(tickets)

    repo.aggregate.mockReturnValue({ toArray: () => Promise.resolve([{}]) })
    await expect(service.list(APARTMENT_ID)).resolves.toEqual([])

    repo.aggregate.mockReturnValue({ toArray: () => Promise.resolve([]) })
    await expect(service.list(APARTMENT_ID)).rejects.toBeInstanceOf(
      NotFoundException
    )
  })
})

describe('Apartment.maintenanceTickets', () => {
  it('is dropped from a loaded entity so save() cannot overwrite the array', () => {
    const apartment = new Apartment()
    apartment.maintenanceTickets = [{ description: 'stale' } as never]
    apartment.stripMaintenanceTickets?.()
    expect('maintenanceTickets' in apartment).toBe(false)
  })

  it('registers the strip hook as a TypeORM AFTER_LOAD listener', () => {
    const listener = getMetadataArgsStorage().entityListeners.find(
      l =>
        l.target === Apartment && l.propertyName === 'stripMaintenanceTickets'
    )
    expect(listener?.type).toBe('after-load')
  })

  it('is never exposed by the response mappers', () => {
    const apartment = {
      _id: new ObjectId(APARTMENT_ID),
      title: 'A',
      category: 'apartment',
      buildingId: null,
      buildingName: null,
      projectId: null,
      projectName: null,
      description: '',
      location: '',
      city: '',
      district: '',
      ward: '',
      street: '',
      address: '',
      priceMonthly: 5_000_000,
      area: 30,
      bedrooms: 1,
      bathrooms: 1,
      direction: '',
      balconyDirection: '',
      furniture: '',
      moveInTime: '',
      electricity: '',
      water: '',
      internet: '',
      gallery: [],
      images360: [],
      vrUrl: '',
      amenities: [],
      status: 'available' as const,
      isVerified: false,
      landlordId: 'landlord-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      maintenanceTickets: [
        { tenantId: 'SECRET-TENANT', description: 'SECRET-DESC' },
      ],
    } as never
    const outputs = [
      ApartmentResponseMapper.toWebJson(apartment),
      ApartmentResponseMapper.toMobileJson(apartment),
      ApartmentResponseMapper.toLandlordJson(apartment),
      ApartmentResponseMapper.toStaffJson(apartment),
    ]
    for (const out of outputs) {
      const json = JSON.stringify(out)
      expect(json).not.toContain('maintenanceTickets')
      expect(json).not.toContain('SECRET')
    }
  })
})
