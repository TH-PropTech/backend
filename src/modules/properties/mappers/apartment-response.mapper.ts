import { Apartment } from '../schemas/apartment.schema'
import { User } from '../../users/schemas/user.schema'
import type {
  MoveOutPolicy,
  RentalPackageSnapshot,
} from '../utils/rental-package.util'
import { DEFAULT_MOVE_OUT_RESPONSE_DAYS } from '../../rental/utils/deposit-refund.constants'
import type { RentalExecutionPolicyRef } from '../../rental/utils/rental-execution-policy.util'

const VND_PER_MILLION = 1_000_000

/** `priceMonthly` is always stored in VND; "triệu" is derived, never guessed. */
function toMillions(priceMonthlyVnd: number): number {
  return priceMonthlyVnd / VND_PER_MILLION
}

function formatMonthlyRent(priceMonthlyVnd: number): string {
  if (priceMonthlyVnd >= VND_PER_MILLION) {
    return `${toMillions(priceMonthlyVnd)} triệu/tháng`
  }
  return `${priceMonthlyVnd.toLocaleString('vi-VN')} đ/tháng`
}

export interface RentalPackageResponse {
  packageId: string
  version: number
  durationMonths: 1 | 3 | 6 | 12 | 24
  monthlyRent: number
  depositPolicy: RentalPackageSnapshot['depositPolicy']
  resolvedDepositAmount: number
  settlementPolicy?: RentalPackageSnapshot['settlementPolicy']
  resolvedHoldingDepositAmount?: number
  resolvedSecurityTopUpAmount?: number
  prepaidRent?: RentalPackageSnapshot['prepaidRent']
  resolvedPrepaidRentMonths?: number
  resolvedPrepaidRentAmount?: number
  moveOutPolicy: MoveOutPolicy
  status: 'active' | 'inactive'
  allowedExecutionPolicies?: RentalExecutionPolicyRef[]
  defaultExecutionPolicy?: RentalExecutionPolicyRef
}

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
  priceVnd: number
  area: string
  areaNum: number
  rooms: string
  city: string
  district: string
  ward: string
  street: string
  projectName: string | null
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
  pricingMode: 'packages' | 'legacy'
  pricingRevision: number
  rentalPackages: RentalPackageResponse[]
  rentalAvailabilityStatus: 'available' | 'reserved' | 'deposit-paid' | 'rented'
  rentalAvailabilityLabel: string
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
  location: string
  city: string
  district: string
  ward: string
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
  pricingMode: 'packages' | 'legacy'
  pricingRevision: number
  rentalPackages: RentalPackageResponse[]
  rentalAvailabilityStatus: 'available' | 'reserved' | 'deposit-paid' | 'rented'
  rentalAvailabilityLabel: string
  landlord?: {
    id: string
    fullName: string
    email: string
    phone: string
    avatar: string
    kycStatus: string
  } | null
}

/**
 * Dữ liệu "Tin đăng của tôi" cho chủ nhà: giữ nguyên giá VND và mọi trường form
 * chỉnh sửa/nộp lại cần (web/mobile shape đổi đơn vị giá và thiếu address, street…).
 */
export interface LandlordApartmentResponse {
  id: string
  title: string
  category: string
  description: string
  location: string
  city: string
  district: string
  ward: string
  street: string
  address: string
  priceMonthly: number
  area: number
  bedrooms: number
  bathrooms: number
  direction: string
  balconyDirection: string
  furniture: string
  moveInTime: string
  electricity: string
  water: string
  internet: string
  gallery: string[]
  images360: string[]
  vrUrl: string
  amenities: string[]
  status: string
  rejectedReason: string | null
  submittedAt: Date | null
  approvedAt: Date | null
  expiresAt: Date | null
  projectName: string
  projectId: string | null
  pricingMode: 'packages' | 'legacy'
  pricingRevision: number
  rentalPackages: RentalPackageResponse[]
}

/** Shape cho màn quản lý của nhân viên: dữ liệu chủ nhà + trạng thái xác minh + liên hệ chủ nhà. */
export interface StaffApartmentResponse extends LandlordApartmentResponse {
  isVerified: boolean
  landlordId: string
  landlord: { fullName: string; phone: string; email: string } | null
}

export class ApartmentResponseMapper {
  static toStaffJson(
    apartment: Apartment & { landlord?: Partial<User> | null }
  ): StaffApartmentResponse {
    const { landlord } = apartment
    return {
      ...ApartmentResponseMapper.toLandlordJson(apartment),
      isVerified: apartment.isVerified ?? false,
      landlordId: apartment.landlordId,
      landlord: landlord
        ? {
            fullName: landlord.fullName ?? '',
            phone: landlord.phone ?? '',
            email: landlord.email ?? '',
          }
        : null,
    }
  }

  static toLandlordJson(apartment: Apartment): LandlordApartmentResponse {
    return {
      id: apartment._id.toString(),
      title: apartment.title,
      category: apartment.category,
      description: apartment.description,
      location: apartment.location,
      city: apartment.city,
      district: apartment.district,
      ward: apartment.ward,
      street: apartment.street,
      address: apartment.address,
      priceMonthly: apartment.priceMonthly,
      area: apartment.area,
      bedrooms: apartment.bedrooms,
      bathrooms: apartment.bathrooms,
      direction: apartment.direction ?? '',
      balconyDirection: apartment.balconyDirection ?? '',
      furniture: apartment.furniture ?? '',
      moveInTime: apartment.moveInTime ?? '',
      electricity: apartment.electricity ?? '',
      water: apartment.water ?? '',
      internet: apartment.internet ?? '',
      gallery: apartment.gallery ?? [],
      images360: apartment.images360 ?? [],
      vrUrl: apartment.vrUrl ?? '',
      amenities: apartment.amenities ?? [],
      status: apartment.status,
      rejectedReason: apartment.rejectedReason ?? null,
      submittedAt: apartment.submittedAt ?? null,
      approvedAt: apartment.approvedAt ?? null,
      expiresAt: apartment.expiresAt ?? null,
      projectName: apartment.projectName ?? '',
      projectId: apartment.projectId ?? null,
      pricingMode: apartment.pricingMode ?? 'legacy',
      pricingRevision: apartment.pricingRevision ?? 0,
      rentalPackages: ApartmentResponseMapper.mapRentalPackages(apartment),
    }
  }

  private static mapRentalPackages(
    apartment: Apartment
  ): RentalPackageResponse[] {
    return (apartment.rentalPackages ?? []).map(rentalPackage => ({
      packageId: rentalPackage.packageId,
      version: rentalPackage.version,
      durationMonths: rentalPackage.durationMonths,
      monthlyRent: rentalPackage.monthlyRent,
      depositPolicy: rentalPackage.depositPolicy,
      resolvedDepositAmount: rentalPackage.resolvedDepositAmount,
      moveOutPolicy: rentalPackage.moveOutPolicy ?? {
        responseDays: DEFAULT_MOVE_OUT_RESPONSE_DAYS,
      },
      ...(rentalPackage.settlementPolicy
        ? { settlementPolicy: rentalPackage.settlementPolicy }
        : {}),
      ...(rentalPackage.resolvedHoldingDepositAmount !== undefined
        ? {
            resolvedHoldingDepositAmount:
              rentalPackage.resolvedHoldingDepositAmount,
          }
        : {}),
      ...(rentalPackage.resolvedSecurityTopUpAmount !== undefined
        ? {
            resolvedSecurityTopUpAmount:
              rentalPackage.resolvedSecurityTopUpAmount,
          }
        : {}),
      ...(rentalPackage.prepaidRent
        ? {
            prepaidRent: rentalPackage.prepaidRent,
            ...(rentalPackage.resolvedPrepaidRentMonths !== undefined
              ? {
                  resolvedPrepaidRentMonths:
                    rentalPackage.resolvedPrepaidRentMonths,
                }
              : {}),
            ...(rentalPackage.resolvedPrepaidRentAmount !== undefined
              ? {
                  resolvedPrepaidRentAmount:
                    rentalPackage.resolvedPrepaidRentAmount,
                }
              : {}),
          }
        : {}),
      status: rentalPackage.status,
      ...(rentalPackage.allowedExecutionPolicies
        ? { allowedExecutionPolicies: rentalPackage.allowedExecutionPolicies }
        : {}),
      ...(rentalPackage.defaultExecutionPolicy
        ? { defaultExecutionPolicy: rentalPackage.defaultExecutionPolicy }
        : {}),
    }))
  }

  private static mapRentalAvailability(apartment: Apartment): {
    status: 'available' | 'reserved' | 'deposit-paid' | 'rented'
    label: string
  } {
    const reservation = apartment.rentalReservation
    if (reservation?.contractId) {
      return { status: 'rented', label: 'Đang cho thuê' }
    }
    if (reservation?.mode === 'deposit-paid') {
      return { status: 'deposit-paid', label: 'Đã đặt cọc' }
    }
    if (reservation?.applicationId) {
      return { status: 'reserved', label: 'Có người giữ chỗ' }
    }
    return { status: 'available', label: 'Đang trống' }
  }

  // Map to Next.js Web Frontend (ApartmentItem type)
  static toWebJson(
    apartment: Apartment & { landlord?: User | null }
  ): WebApartmentResponse {
    const priceInMillions = toMillions(apartment.priceMonthly)
    const rentalAvailability =
      ApartmentResponseMapper.mapRentalAvailability(apartment)

    let tag = 'pending'
    let tagText = 'Chờ duyệt'

    switch (apartment.status) {
      case 'available':
        tag = rentalAvailability.status
        tagText = rentalAvailability.label
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
      case 'rented':
        tag = 'rented'
        tagText = 'Đang cho thuê'
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
      price: formatMonthlyRent(apartment.priceMonthly),
      priceNum: priceInMillions,
      priceVnd: apartment.priceMonthly,
      area: `${apartment.area} m²`,
      areaNum: apartment.area,
      rooms: `${apartment.bedrooms} PN - ${apartment.bathrooms} WC`,
      city: apartment.city,
      district: apartment.district,
      ward: apartment.ward,
      street: apartment.street,
      projectName: apartment.projectName || null,
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
      pricingMode: apartment.pricingMode ?? 'legacy',
      pricingRevision: apartment.pricingRevision ?? 0,
      rentalPackages: ApartmentResponseMapper.mapRentalPackages(apartment),
      rentalAvailabilityStatus: rentalAvailability.status,
      rentalAvailabilityLabel: rentalAvailability.label,
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
    const priceInMillions = toMillions(apartment.priceMonthly)
    const rentalAvailability =
      ApartmentResponseMapper.mapRentalAvailability(apartment)
    return {
      id: apartment._id.toString(),
      title: apartment.title,
      projectName: apartment.projectName || null,
      projectId: apartment.projectId || null,
      location: apartment.location,
      city: apartment.city,
      district: apartment.district,
      ward: apartment.ward,
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
      pricingMode: apartment.pricingMode ?? 'legacy',
      pricingRevision: apartment.pricingRevision ?? 0,
      rentalPackages: ApartmentResponseMapper.mapRentalPackages(apartment),
      rentalAvailabilityStatus: rentalAvailability.status,
      rentalAvailabilityLabel: rentalAvailability.label,
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
