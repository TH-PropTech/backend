import { Apartment } from '../schemas/apartment.schema'

export interface WebApartmentResponse {
  id: string
  title: string
  category: string
  tag: string
  tagText: string
  description: string
  location: string
  price: string
  priceNum: number
  area: string
  areaNum: number
  rooms: string
  city: string
  district: string
  ward: string
  street: string
  projectName: string
  bedrooms: number
  bathrooms: number
  direction: string
  balconyDirection: string
  furniture: string
  moveInTime: string
  electricityPriceType: string
  waterPriceType: string
  internetPriceType: string
  amenities: string[]
  isVerified: boolean
  hasMedia: boolean
}

export interface MobileApartmentResponse {
  id: string
  title: string
  projectName: string
  projectId: string | null
  location: string
  city: string
  priceMonthly: number
  area: number
  bedrooms: number
  bathrooms: number
  status: string
  verified: boolean
  image: string
  gallery: string[]
  category: string
  description: string
  address: string
  direction: string
  balconyDirection: string
  furniture: string
  moveInTime: string
  electricity: string
  water: string
  internet: string
  amenities: string[]
}

export class ApartmentResponseMapper {
  // Map to Next.js Web Frontend (ApartmentItem type)
  static toWebJson(apartment: Apartment): WebApartmentResponse {
    return {
      id: apartment._id.toString(),
      title: apartment.title,
      category: apartment.category,
      tag: apartment.status === 'available' ? 'empty' : apartment.status,
      tagText: apartment.status === 'available' ? 'Đang trống' : 'Đang xử lý',
      description: apartment.description,
      location: apartment.location,
      price: `${apartment.priceMonthly} triệu/tháng`,
      priceNum: apartment.priceMonthly,
      area: `${apartment.area} m²`,
      areaNum: apartment.area,
      rooms: `${apartment.bedrooms} PN - ${apartment.bathrooms} WC`,
      city: apartment.city,
      district: apartment.district,
      ward: apartment.ward,
      street: apartment.street,
      projectName: apartment.projectName,
      bedrooms: apartment.bedrooms,
      bathrooms: apartment.bathrooms,
      direction: apartment.direction,
      balconyDirection: apartment.balconyDirection,
      furniture: apartment.furniture,
      moveInTime: apartment.moveInTime,
      electricityPriceType: apartment.electricity,
      waterPriceType: apartment.water,
      internetPriceType: apartment.internet,
      amenities: apartment.amenities,
      isVerified: apartment.isVerified,
      hasMedia: apartment.gallery.length > 0 || !!apartment.vrUrl,
    }
  }

  // Map to React Native Mobile (PropertyDetail type)
  static toMobileJson(apartment: Apartment): MobileApartmentResponse {
    return {
      id: apartment._id.toString(),
      title: apartment.title,
      projectName: apartment.projectName,
      projectId: apartment.projectId || null,
      location: apartment.location,
      city: apartment.city,
      priceMonthly: apartment.priceMonthly,
      area: apartment.area,
      bedrooms: apartment.bedrooms,
      bathrooms: apartment.bathrooms,
      status:
        apartment.status === 'unavailable' ? 'updating' : apartment.status,
      verified: apartment.isVerified,
      image: apartment.gallery[0] || '',
      gallery: apartment.gallery,
      category: apartment.category,
      description: apartment.description,
      address: apartment.address,
      direction: apartment.direction,
      balconyDirection: apartment.balconyDirection,
      furniture: apartment.furniture,
      moveInTime: apartment.moveInTime,
      electricity: apartment.electricity,
      water: apartment.water,
      internet: apartment.internet,
      amenities: apartment.amenities,
    }
  }
}
