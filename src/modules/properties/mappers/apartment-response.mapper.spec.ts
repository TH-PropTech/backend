import { ObjectId } from 'mongodb'
import { ApartmentResponseMapper } from './apartment-response.mapper'

describe('ApartmentResponseMapper rental pricing', () => {
  it('maps package pricing fields consistently for web and mobile responses', () => {
    const apartment = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      title: 'Apartment',
      category: 'apartment',
      buildingId: null,
      buildingName: null,
      projectId: null,
      projectName: null,
      description: 'Description',
      location: 'District 1',
      city: 'HCMC',
      district: 'District 1',
      ward: 'Ben Nghe',
      street: 'Street',
      address: 'Address',
      priceMonthly: 12000000,
      pricingMode: 'packages' as const,
      pricingRevision: 3,
      rentalPackages: [
        {
          packageId: 'pkg-12m',
          version: 2,
          durationMonths: 12 as const,
          monthlyRent: 10000000,
          depositPolicy: { type: 'MONTHS_OF_RENT' as const, months: 2 },
          resolvedDepositAmount: 20000000,
          settlementPolicy: {
            holdingDeposit: {
              type: 'FIXED_AMOUNT' as const,
              amount: 6_000_000,
            },
            allowedPaymentCycles: [1, 3, 6] as Array<1 | 3 | 6>,
            defaultPaymentCycle: 3 as const,
            firstPaymentDueOffsetDays: 3,
          },
          resolvedHoldingDepositAmount: 6_000_000,
          resolvedSecurityTopUpAmount: 14_000_000,
          status: 'active' as const,
        },
      ],
      area: 50,
      bedrooms: 2,
      bathrooms: 1,
      direction: 'East',
      balconyDirection: 'East',
      furniture: 'Full',
      moveInTime: 'Immediate',
      electricity: 'metered',
      water: 'metered',
      internet: 'included',
      gallery: [],
      images360: [],
      vrUrl: '',
      amenities: [],
      status: 'available' as const,
      isVerified: true,
      landlordId: 'landlord-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const web = ApartmentResponseMapper.toWebJson(apartment)
    const mobile = ApartmentResponseMapper.toMobileJson(apartment)

    expect(web.pricingMode).toBe('packages')
    expect(web.pricingRevision).toBe(3)
    expect(web.rentalPackages).toEqual(mobile.rentalPackages)
    expect(web.rentalPackages[0]?.resolvedDepositAmount).toBe(20000000)
    expect(web.rentalPackages[0]?.resolvedHoldingDepositAmount).toBe(6_000_000)
    expect(web.rentalPackages[0]?.resolvedSecurityTopUpAmount).toBe(14_000_000)
    const rented = ApartmentResponseMapper.toWebJson({
      ...apartment,
      status: 'rented',
      rentalReservation: { applicationId: 'app-1', contractId: 'contract-1' },
    } as never)
    expect(rented.tag).toBe('rented')
    expect(rented.rentalAvailabilityStatus).toBe('rented')
  })

  it('defaults legacy listings to an empty package list', () => {
    const apartment = {
      _id: new ObjectId('507f1f77bcf86cd799439012'),
      title: 'Legacy apartment',
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
      priceMonthly: 5000000,
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
      status: 'pending' as const,
      isVerified: false,
      landlordId: 'landlord-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const response = ApartmentResponseMapper.toMobileJson(apartment)

    expect(response.pricingMode).toBe('legacy')
    expect(response.pricingRevision).toBe(0)
    expect(response.rentalPackages).toEqual([])
    expect(response.rentalAvailabilityStatus).toBe('available')
    expect(response.rentalAvailabilityLabel).toBe('Đang trống')
  })

  it('projects reservation and deposit tags without changing listing moderation status', () => {
    const apartment = {
      _id: new ObjectId('507f1f77bcf86cd799439013'),
      title: 'Reserved apartment',
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
      priceMonthly: 5000000,
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
      isVerified: true,
      landlordId: 'landlord-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      rentalReservation: {
        applicationId: 'app-1',
        reservedAt: new Date(),
        mode: 'deposit-paid' as const,
      },
    }
    const response = ApartmentResponseMapper.toWebJson(apartment)
    expect(response.status).toBe('available')
    expect(response.rentalAvailabilityStatus).toBe('deposit-paid')
    expect(response.rentalAvailabilityLabel).toBe('Đã đặt cọc')
  })
})
