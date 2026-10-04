import { ObjectId } from 'mongodb'
import { ApartmentResponseMapper } from './apartment-response.mapper'

function buildApartment(priceMonthly: number): never {
  return {
    _id: new ObjectId('507f1f77bcf86cd799439011'),
    title: 'Apartment',
    category: 'apartment',
    description: 'Description',
    location: 'District 1',
    city: 'HCMC',
    district: 'District 1',
    ward: 'Ben Nghe',
    street: 'Street',
    address: 'Address',
    priceMonthly,
    pricingMode: 'legacy',
    pricingRevision: 0,
    rentalPackages: [],
    area: 50,
    bedrooms: 1,
    bathrooms: 1,
    status: 'available',
    isVerified: true,
    amenities: [],
    images360: [],
    gallery: [],
  } as never
}

describe('ApartmentResponseMapper price units', () => {
  it('shows VND amounts below one million as đ instead of guessing triệu', () => {
    const web = ApartmentResponseMapper.toWebJson(buildApartment(100000))

    expect(web.priceVnd).toBe(100000)
    expect(web.priceNum).toBeCloseTo(0.1)
    expect(web.price).toBe(`${(100000).toLocaleString('vi-VN')} đ/tháng`)
  })

  it('shows amounts from one million as triệu', () => {
    const web = ApartmentResponseMapper.toWebJson(buildApartment(14500000))

    expect(web.priceVnd).toBe(14500000)
    expect(web.priceNum).toBe(14.5)
    expect(web.price).toBe('14.5 triệu/tháng')
  })

  it('keeps mobile priceMonthly in millions without the below-1M heuristic', () => {
    const small = ApartmentResponseMapper.toMobileJson(buildApartment(100000))
    const large = ApartmentResponseMapper.toMobileJson(buildApartment(1000000))

    expect(small.priceMonthly).toBeCloseTo(0.1)
    expect(large.priceMonthly).toBe(1)
  })
})
