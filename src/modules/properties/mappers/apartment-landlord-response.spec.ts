import { ObjectId } from 'mongodb'
import type { Apartment } from '../schemas/apartment.schema'
import { ApartmentResponseMapper } from './apartment-response.mapper'

function buildApartment(overrides: Partial<Apartment> = {}): Apartment {
  return {
    _id: new ObjectId('507f1f77bcf86cd799439011'),
    title: 'Căn hộ 2PN Vinhomes Grand Park',
    category: 'Căn hộ chung cư',
    description: 'Mô tả',
    location: 'Nguyễn Xiển, Long Thạnh Mỹ, Quận 9, TP.HCM',
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
    electricity: 'Giá nhà nước',
    water: 'Giá nhà nước',
    internet: 'Miễn phí',
    gallery: ['https://res.cloudinary.com/x/a.jpg'],
    images360: [],
    vrUrl: '',
    amenities: ['pool'],
    status: 'rejected',
    rejectedReason: 'Ảnh không rõ ràng',
    submittedAt: new Date('2026-09-19T00:00:00.000Z'),
    approvedAt: null,
    expiresAt: null,
    projectName: 'Vinhomes Grand Park',
    projectId: 'p-1',
    pricingMode: 'legacy',
    pricingRevision: 0,
    rentalPackages: [],
    ...overrides,
  } as unknown as Apartment
}

describe('ApartmentResponseMapper.toStaffJson', () => {
  it('adds verification, owner id and landlord contact to the landlord shape', () => {
    const json = ApartmentResponseMapper.toStaffJson({
      ...buildApartment({
        status: 'available',
        isVerified: true,
        landlordId: 'landlord-1',
      }),
      landlord: {
        _id: new ObjectId('507f1f77bcf86cd799439031'),
        fullName: 'Nguyễn Văn A',
        phone: '0901234567',
        email: 'a@example.com',
      },
    })

    expect(json).toMatchObject({
      id: '507f1f77bcf86cd799439011',
      priceMonthly: 15_000_000,
      status: 'available',
      isVerified: true,
      landlordId: 'landlord-1',
      landlord: {
        fullName: 'Nguyễn Văn A',
        phone: '0901234567',
        email: 'a@example.com',
      },
    })
  })

  it('returns a null landlord when none is attached', () => {
    const json = ApartmentResponseMapper.toStaffJson(buildApartment())

    expect(json.landlord).toBeNull()
    expect(json.isVerified).toBe(false)
  })
})

describe('ApartmentResponseMapper.toLandlordJson', () => {
  it('keeps the raw VND price and every field the landlord edit form needs', () => {
    const json = ApartmentResponseMapper.toLandlordJson(buildApartment())

    expect(json).toMatchObject({
      id: '507f1f77bcf86cd799439011',
      priceMonthly: 15_000_000,
      address: '12 Nguyễn Xiển',
      street: 'Nguyễn Xiển',
      electricity: 'Giá nhà nước',
      water: 'Giá nhà nước',
      internet: 'Miễn phí',
      projectId: 'p-1',
      status: 'rejected',
      rejectedReason: 'Ảnh không rõ ràng',
    })
  })

  it('does not rescale the price like the web/mobile shapes do', () => {
    const json = ApartmentResponseMapper.toLandlordJson(
      buildApartment({ priceMonthly: 2_500_000 })
    )

    expect(json.priceMonthly).toBe(2_500_000)
  })

  it('exposes expired listings so the landlord can renew them', () => {
    const json = ApartmentResponseMapper.toLandlordJson(
      buildApartment({ status: 'expired' })
    )

    expect(json.status).toBe('expired')
  })

  it('never returns undefined for optional text or list fields', () => {
    const json = ApartmentResponseMapper.toLandlordJson(
      buildApartment({
        direction: undefined,
        electricity: undefined,
        gallery: undefined,
        images360: undefined,
        vrUrl: undefined,
        amenities: undefined,
        projectName: undefined,
        projectId: undefined,
        rejectedReason: undefined,
        submittedAt: undefined,
        expiresAt: undefined,
      } as unknown as Partial<Apartment>)
    )

    expect(json.direction).toBe('')
    expect(json.electricity).toBe('')
    expect(json.gallery).toEqual([])
    expect(json.images360).toEqual([])
    expect(json.vrUrl).toBe('')
    expect(json.amenities).toEqual([])
    expect(json.projectName).toBe('')
    expect(json.projectId).toBeNull()
    expect(json.rejectedReason).toBeNull()
    expect(json.submittedAt).toBeNull()
    expect(json.expiresAt).toBeNull()
  })

  it('maps the rental packages like the other shapes', () => {
    const json = ApartmentResponseMapper.toLandlordJson(
      buildApartment({
        pricingMode: 'packages',
        pricingRevision: 2,
        rentalPackages: [
          {
            packageId: 'pkg-3m',
            version: 1,
            durationMonths: 3,
            monthlyRent: 12_000_000,
            depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
            status: 'active',
          },
        ],
      } as unknown as Partial<Apartment>)
    )

    expect(json.pricingMode).toBe('packages')
    expect(json.rentalPackages).toHaveLength(1)
    expect(json.rentalPackages[0]?.packageId).toBe('pkg-3m')
  })
})
