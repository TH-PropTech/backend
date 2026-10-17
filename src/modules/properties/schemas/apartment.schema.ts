import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  AfterLoad,
} from 'typeorm'
import type { RentalPackageRecord } from '../utils/rental-package.util'
import type { ReviewRatings } from './review.schema'

/** Phiếu bảo trì nhúng trong căn hộ (thay cho collection `maintenance_tickets`). */
export interface MaintenanceTicketEntry {
  _id: ObjectId
  tenantId: string
  propertyTitle?: string
  description: string
  images: string[]
  status: 'pending' | 'in-progress' | 'resolved' | 'cancelled'
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Số phiếu bảo trì tối đa trong một căn hộ (409 khi vượt). */
export const MAX_MAINTENANCE_TICKETS = 100
/** Đánh giá nhúng trong căn hộ (G-REV, thay cho collection `reviews`). */
export interface ApartmentReviewEntry {
  _id: ObjectId
  authorId: string
  authorName: string
  targetUserId: string
  contractId: string
  comment: string
  ratings: ReviewRatings
  overall: number
  createdAt: Date
  updatedAt: Date
}

/** Số đánh giá tối đa trong một căn hộ (khớp `APARTMENT_REVIEWS_LIMIT` của migration 030). */
export const MAX_APARTMENT_REVIEWS = 100
/** Phong cách thiết kế cho viewer 3D (khớp bảng THEMES của apartment-3d-renderer). */
export const APARTMENT_DESIGN_THEMES = [
  'modern',
  'nordic',
  'warm',
  'luxury',
  'industrial',
] as const
export type ApartmentDesignTheme = (typeof APARTMENT_DESIGN_THEMES)[number]
export const APARTMENT_DESIGN_FURNISHING = ['bare', 'partial', 'full'] as const
export type ApartmentDesignFurnishing =
  (typeof APARTMENT_DESIGN_FURNISHING)[number]

/** Ghi đè từng màu của phong cách (chuỗi #RRGGBB); thiếu khoá = dùng màu của phong cách. */
export interface ApartmentDesignPalette {
  floor?: string
  wall?: string
  wood?: string
  sofa?: string
  accent?: string
}

/** Một thiết kế 3D của căn hộ, nhúng trong `Apartment.floorplanDesigns[]` (admin tạo/ẩn/hiện). */
export interface ApartmentDesignEntry {
  id: string
  name: string
  description: string
  theme: ApartmentDesignTheme
  palette: ApartmentDesignPalette
  /** null = theo mức nội thất của tin đăng. */
  furnishing: ApartmentDesignFurnishing | null
  /** Giờ mặc định (6..18) khi mở thiết kế này. */
  defaultHour: number
  visible: boolean
  order: number
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

/** Số thiết kế tối đa của một căn hộ (409 khi vượt). */
export const MAX_APARTMENT_DESIGNS = 12
/** Số ảnh tối đa trong một phiếu bảo trì. */
export const MAX_MAINTENANCE_TICKET_IMAGES = 20

@Entity('apartments')
export class Apartment {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  title!: string

  @Column({ nullable: true })
  buildingId!: string | null

  @Column({ default: '', nullable: true })
  buildingName!: string | null

  @Column({ nullable: true })
  projectId!: string | null

  @Column({ default: '', nullable: true })
  projectName!: string | null

  @Column()
  category!: string

  @Column()
  description!: string

  @Column()
  location!: string

  @Column()
  city!: string

  /** Số giấy chứng nhận quyền sở hữu/sử dụng căn hộ (tùy chọn, dùng khi lập hợp đồng). */
  @Column({ nullable: true })
  ownershipCertificate?: string | null

  @Column()
  district!: string

  @Column()
  ward!: string

  @Column()
  street!: string

  @Column()
  address!: string

  @Column()
  priceMonthly!: number

  @Column({ type: 'string', default: 'legacy' })
  pricingMode?: 'packages' | 'legacy'

  @Column({ nullable: true })
  legacyFlow?: boolean | null

  @Column({ default: 0 })
  pricingRevision?: number

  @Column('array')
  rentalPackages?: RentalPackageRecord[]

  @Column()
  area!: number

  @Column()
  bedrooms!: number

  @Column()
  bathrooms!: number

  @Column()
  direction!: string

  @Column()
  balconyDirection!: string

  @Column()
  furniture!: string

  @Column()
  moveInTime!: string

  @Column()
  electricity!: string

  @Column()
  water!: string

  @Column()
  internet!: string

  @Column('array')
  gallery!: string[]

  /** Danh sách ảnh 360 độ của căn hộ (ví dụ: 360 phòng khách, 360 phòng ngủ) */
  @Column('array')
  images360!: string[]

  @Column({ default: '' })
  vrUrl!: string

  @Column('array')
  amenities!: string[]

  @Column({ type: 'string', default: 'pending' })
  status!:
    | 'pending'
    | 'available'
    | 'rejected'
    | 'expired'
    | 'unavailable'
    | 'rented'
    | 'updating'

  @Column({ default: false })
  isVerified!: boolean

  @Column()
  landlordId!: string

  /** Transfer audit reference; landlordId remains the current owner. */
  @Column({ nullable: true })
  ownershipTransferId?: string | null

  @Column({ nullable: true })
  submittedAt?: Date | null

  @Column({ nullable: true })
  approvedAt?: Date | null

  @Column({ nullable: true })
  approvedBy?: string | null

  @Column({ nullable: true })
  expiresAt?: Date | null

  @Column({ type: 'json', nullable: true, default: null })
  rentalReservation?: {
    applicationId: string
    reservedAt: Date
    mode: 'application-accepted' | 'deposit-paid'
    revision?: number | null
    acceptedAt?: Date | null
    depositAgreementId?: string | null
    contractId?: string | null
    depositPaidAt?: Date | null
    leaseActivatedAt?: Date | null
    releasedAt?: Date | null
  } | null

  @Column({ default: '', nullable: true })
  rejectedReason?: string | null

  /**
   * Phiếu bảo trì nhúng (G-MNT). CHỈ ghi bằng `updateOne` $push có trần
   * (`MaintenanceTicketsService`). Vì `save(apartment)` ghi đè mọi cột đã nạp,
   * `stripMaintenanceTickets` bỏ trường này khỏi entity vừa nạp để `save` không
   * bao giờ mang theo bản sao cũ của mảng. Đọc phiếu qua `MaintenanceTicketsService.list`.
   */
  @Column('array')
  maintenanceTickets?: MaintenanceTicketEntry[]

  /**
   * Đánh giá nhúng (G-REV). Chỉ ghi bằng `updateOne` (migration 030 dùng `$push` có trần).
   * Giống `maintenanceTickets`, `stripReviews` bỏ trường này khỏi entity vừa nạp để `save` không ghi đè mảng.
   */
  @Column('array')
  reviews?: ApartmentReviewEntry[]

  /**
   * Thiết kế 3D nhúng. Chỉ ghi bằng `updateOne` ($push/$set/$pull có điều kiện, `ApartmentDesignsService`);
   * `stripFloorplanDesigns` bỏ trường này khỏi entity vừa nạp để `save` không ghi đè mảng.
   */
  @Column('array')
  floorplanDesigns?: ApartmentDesignEntry[]

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date

  @AfterLoad()
  stripFloorplanDesigns?(): void {
    delete this.floorplanDesigns
  }

  @AfterLoad()
  stripReviews?(): void {
    delete this.reviews
  }

  @AfterLoad()
  // Tùy chọn (`?`) để literal/spread kiểu `Apartment` không phải khai báo hook này.
  stripMaintenanceTickets?(): void {
    delete this.maintenanceTickets
  }
}
