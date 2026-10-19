import { ObjectId } from 'mongodb'
import { getMetadataArgsStorage } from 'typeorm'
import { ApartmentResponseMapper } from '../mappers/apartment-response.mapper'
import { Apartment } from './apartment.schema'

const APARTMENT_ID = '507f1f77bcf86cd799439011'

describe('Apartment.reviews (G-REV)', () => {
  it('is dropped from a loaded entity so save() cannot overwrite the array', () => {
    const apartment = new Apartment()
    apartment.reviews = [{ comment: 'stale' } as never]
    apartment.stripReviews?.()
    expect('reviews' in apartment).toBe(false)
  })

  it('registers the strip hook as a TypeORM AFTER_LOAD listener', () => {
    const listener = getMetadataArgsStorage().entityListeners.find(
      l => l.target === Apartment && l.propertyName === 'stripReviews'
    )
    expect(listener?.type).toBe('after-load')
  })

  it('is never exposed by the response mappers', () => {
    const apartment = {
      _id: new ObjectId(APARTMENT_ID),
      title: 'A',
      category: 'apartment',
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
      reviews: [
        {
          _id: new ObjectId(),
          authorId: 'SECRET-AUTHOR',
          authorName: 'SECRET-NAME',
          comment: 'SECRET-COMMENT',
        },
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
      expect(json).not.toContain('reviews')
      expect(json).not.toContain('SECRET')
    }
  })
})
