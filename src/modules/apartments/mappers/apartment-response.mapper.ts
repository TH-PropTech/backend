import { Apartment } from '../schemas/apartment.schema'
import { User } from '../../users/schemas/user.schema'

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
  projectName: string | null
  buildingId: string | null
  buildingName: string | null
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
  images360: string[]
  image: string
  gallery: string[]
  status: string
  submittedAt?: Date | null
  approvedAt?: Date | null
  approvedBy?: string | null
  expiresAt?: Date | null
  rejectedReason?: string | null
  landlord?: {
    id: string
    fullName: string
    email: string
    phone: string
    avatar: string
    kycStatus: string
  } | null
}

export interface MobileApartmentResponse {
  id: string
  title: string
  projectName: string | null
  projectId: string | null
  buildingId: string | null
  buildingName: string | null
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
  images360: string[]
  submittedAt?: Date | null
  approvedAt?: Date | null
  approvedBy?: string | null
  expiresAt?: Date | null
  rejectedReason?: string | null
  landlord?: {
    id: string
    fullName: string
    email: string
    phone: string
    avatar: string
    kycStatus: string
  } | null
}

export class ApartmentResponseMapper {
  // Map to Next.js Web Frontend (ApartmentItem type)
  static toWebJson(
    apartment: Apartment & { landlord?: User | null }
  ): WebApartmentResponse {
    const priceInMillions =
      apartment.priceMonthly >= 1000000
        ? apartment.priceMonthly / 1000000
        : apartment.priceMonthly

    let tag = 'pending'
    let tagText = 'Chờ duyệt'

    switch (apartment.status) {
      case 'available':
        tag = 'empty'
        tagText = 'Đang trống'
        break
      case 'rejected':
        tag = 'rejected'
        tagText = 'Bị từ chối'
        break
      case 'expired':
        tag = 'expired'
        tagText = 'Hết hạn'
        break
      case 'unavailable':
        tag = 'unavailable'
        tagText = 'Đã ẩn/Đóng'
        break
      case 'updating':
        tag = 'updating'
        tagText = 'Đang cập nhật'
        break
    }

    return {
      id: apartment._id.toString(),
      title: apartment.title,
      category: apartment.category,
      tag,
      tagText,
      description: apartment.description,
      location: apartment.location,
      price: `${priceInMillions} triệu/tháng`,
      priceNum: priceInMillions,
      area: `${apartment.area} m²`,
      areaNum: apartment.area,
      rooms: `${apartment.bedrooms} PN - ${apartment.bathrooms} WC`,
      city: apartment.city,
      district: apartment.district,
      ward: apartment.ward,
      street: apartment.street,
      projectName: apartment.projectName || null,
      buildingId: apartment.buildingId || null,
      buildingName: apartment.buildingName || null,
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
      hasMedia:
        apartment.gallery.length > 0 ||
        (apartment.images360 && apartment.images360.length > 0) ||
        !!apartment.vrUrl,
      images360: apartment.images360 || [],
      image: apartment.gallery[0] || '',
      gallery: apartment.gallery || [],
      status: apartment.status,
      submittedAt: apartment.submittedAt ?? null,
      approvedAt: apartment.approvedAt ?? null,
      approvedBy: apartment.approvedBy ?? null,
      expiresAt: apartment.expiresAt ?? null,
      rejectedReason: apartment.rejectedReason ?? null,
      landlord: apartment.landlord
        ? {
            id: apartment.landlord._id.toString(),
            fullName: apartment.landlord.fullName,
            email: apartment.landlord.email,
            phone: apartment.landlord.phone,
            avatar: apartment.landlord.profile?.avatar || '',
            kycStatus: apartment.landlord.kycStatus,
          }
        : null,
    }
  }

  // Map to React Native Mobile (PropertyDetail type)
  static toMobileJson(
    apartment: Apartment & { landlord?: User | null }
  ): MobileApartmentResponse {
    const priceInMillions =
      apartment.priceMonthly >= 1000000
        ? apartment.priceMonthly / 1000000
        : apartment.priceMonthly

    return {
      id: apartment._id.toString(),
      title: apartment.title,
      projectName: apartment.projectName || null,
      projectId: apartment.projectId || null,
      buildingId: apartment.buildingId || null,
      buildingName: apartment.buildingName || null,
      location: apartment.location,
      city: apartment.city,
      priceMonthly: priceInMillions,
      area: apartment.area,
      bedrooms: apartment.bedrooms,
      bathrooms: apartment.bathrooms,
      status: apartment.status,
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
      images360: apartment.images360 || [],
      submittedAt: apartment.submittedAt ?? null,
      approvedAt: apartment.approvedAt ?? null,
      approvedBy: apartment.approvedBy ?? null,
      expiresAt: apartment.expiresAt ?? null,
      rejectedReason: apartment.rejectedReason ?? null,
      landlord: apartment.landlord
        ? {
            id: apartment.landlord._id.toString(),
            fullName: apartment.landlord.fullName,
            email: apartment.landlord.email,
            phone: apartment.landlord.phone,
            avatar: apartment.landlord.profile?.avatar || '',
            kycStatus: apartment.landlord.kycStatus,
          }
        : null,
    }
  }
}
