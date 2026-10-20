import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  AfterLoad,
} from 'typeorm'

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export interface UserProfile {
  firstName: string
  lastName: string
  avatar?: string
}

export interface PinInfo {
  hash: string
  setAt: Date
}

/**
 * Thiết bị Smart OTP đã liên kết, nhúng trong `User.smartOTP.devices[]`
 * (thay thế collection `device_bindings`). Khóa duy nhất trong mảng: `deviceId`.
 * Chỉ được ghi bằng toán tử nguyên tử ($push có điều kiện / $set vị trí / $pull).
 */
export interface DeviceBindingInfo {
  /** `_id` cũ của device_bindings (migration 007) hoặc id sinh khi bind mới. */
  bindingId?: ObjectId
  deviceId: string
  deviceName: string
  publicKey: string
  /** Giá trị của enum DeviceStatus (PENDING | ACTIVE | BLOCKED). */
  status: string
  createdAt: Date
  updatedAt: Date
}

export interface SmartOtpInfo {
  enabled: boolean
  maxDevices: number
  registeredDevices: number
  lockedUntil?: Date
  otpAttempts: number
  lastOtpAt?: Date
  devices?: DeviceBindingInfo[]
}

export interface TwoFactorInfo {
  enabled: boolean
  secret?: string
  enabledAt?: Date
  backupCodes?: string[]
}

export interface UserPreferences {
  fontSize: 'compact' | 'default' | 'large'
  monthlyIncome?: number
  preferredDistricts?: string[]
  preferredRooms?: number
  requiresGym?: boolean
  requiresParking?: boolean
}

export interface DigitalSignatureInfo {
  certificateDn?: string // Distinguished Name của chứng thư số
  serialNumber?: string // Số serial của chứng thư số
  validFrom?: Date // Ngày bắt đầu hiệu lực
  validTo?: Date // Ngày hết hạn hiệu lực
  provider?: string // Nhà cung cấp dịch vụ (ví dụ: VNPT SmartCA)
  status: 'active' | 'suspended' | 'expired' | 'revoked'
}

/**
 * Hồ sơ KYC nhúng trong `User.kyc` (thay thế collection `kyc_records`, migration 026).
 * `recordId` là `_id` cũ của `kyc_records`: id công khai của `GET/PATCH /kyc/:id` và
 * `/kyc/:id/media/:field` vẫn tra được qua `kyc.recordId`. Chỉ ghi bằng `updateOne`
 * với toán tử nguyên tử (`$set` theo trường `kyc.*`), không `save(User)` toàn document.
 * Mọi đọc/liệt kê KYC đi qua truy vấn thô (aggregate) vì `User` bỏ `kyc` khi nạp entity.
 */
export interface KycInfo {
  /** `_id` cũ của `kyc_records` (hoặc id sinh khi nộp mới). */
  recordId: ObjectId
  idCardNumber: string
  frontCardUrl: string
  backCardUrl: string
  selfieUrl: string
  fullName?: string
  dateOfBirth?: string
  gender?: string
  nationality?: string
  placeOfOrigin?: string
  placeOfResidence?: string
  ocrMatchRate?: number
  issueDate?: string
  placeOfIssue?: string
  faceMatchResult?: boolean
  livenessResult?: boolean
  spoofScore?: number
  status: 'pending' | 'verified' | 'rejected'
  rejectedReason: string | null
  verifiedAt: Date | null
  reviewedBy?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface KycUpdateRequest {
  status: 'pending' | 'approved' | 'rejected'
  rejectReason?: string | null
  requestedAt: Date
  reviewedAt?: Date
  newData: {
    fullName?: string
    phone?: string
    profile?: UserProfile
    walletAddress?: string
    digitalSignature?: DigitalSignatureInfo
    kycData?: unknown
  }
}

@Entity('users')
export class User {
  @ObjectIdColumn()
  _id!: ObjectId

  // ── BASIC INFORMATION ──
  @Column()
  fullName!: string

  @Column({ type: 'json', nullable: true })
  profile?: UserProfile

  @Column({ unique: true })
  email!: string

  @Column()
  passwordHash!: string

  @Column()
  @Index({ unique: true })
  phone!: string

  @Column({ nullable: true })
  dateOfBirth?: Date

  @Column({ nullable: true })
  gender?: string

  // ── SYSTEM ROLE & STATUS ──
  @Column({ type: 'string' })
  role!: 'tenant' | 'landlord' | 'staff' | 'admin'

  /**
   * Tên vai trò tùy chỉnh (`Role.name`, có `baseRole`) gán cho người dùng. Vai trò gốc `role`
   * vẫn quyết định route nào dùng được; hồ sơ này chỉ thay bảng bật/tắt thao tác (RBAC).
   * Chỉ ghi bằng `updateOne`/`update`, không `save(User)` toàn document.
   */
  @Column({ type: 'string', nullable: true })
  permissionProfile?: string | null

  @Column({
    type: 'string',
    enum: UserStatus,
    default: UserStatus.INACTIVE,
  })
  status!: UserStatus

  // ── KYC & BLOCKCHAIN WALLET ──
  @Column({ type: 'string', default: 'not-started' })
  kycStatus!: 'not-started' | 'pending' | 'verified' | 'rejected'

  @Column({ type: 'string', nullable: true, default: null })
  kycRejectReason?: string | null

  @Column({ type: 'json', nullable: true, default: null })
  kycData?: unknown

  /**
   * Hồ sơ KYC nhúng (G-KYC, thay `kyc_records`). CHỈ ghi bằng `updateOne` nguyên tử
   * (`KycService`). `@AfterLoad` bỏ trường này khỏi entity vừa nạp để `save(User)` ở
   * bất kỳ đâu không bao giờ ghi đè `kyc` bằng bản sao cũ.
   */
  @Column({ type: 'json', nullable: true })
  kyc?: KycInfo

  @Column({ nullable: true })
  walletAddress!: string | null

  // ── DIGITAL SIGNATURE (CHỮ KÝ SỐ) ──
  @Column({ type: 'json', nullable: true })
  digitalSignature?: DigitalSignatureInfo

  // ── KYC & DIGITAL SIGNATURE UPDATE REQUESTS ──
  @Column({ type: 'json', nullable: true })
  kycUpdateRequest?: KycUpdateRequest

  // ── SECURITY & AUTHORIZATION ──
  @Column({ type: 'json', nullable: true })
  pin?: PinInfo

  @Column({ type: 'json', nullable: true })
  smartOTP?: SmartOtpInfo

  @Column({ type: 'json', nullable: true })
  twoFactor?: TwoFactorInfo

  // ── NOTIFICATIONS & PREFERENCES ──
  @Column({ nullable: true })
  pushToken?: string

  @Column({ type: 'json', nullable: true })
  preferences?: UserPreferences

  @Column({ type: 'json', nullable: true, default: null })
  metadata?: Record<string, unknown>

  @Column({ default: false })
  isDeleted!: boolean

  // ── TIMESTAMPS ──
  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date

  @AfterLoad()
  // Tùy chọn (`?`) để literal/spread kiểu `User` không phải khai báo hook này.
  stripKyc?(): void {
    delete this.kyc
  }
}
