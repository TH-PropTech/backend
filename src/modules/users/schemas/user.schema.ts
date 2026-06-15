import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
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

export interface SmartOtpInfo {
  enabled: boolean
  maxDevices: number
  registeredDevices: number
  lockedUntil?: Date
  otpAttempts: number
  lastOtpAt?: Date
}

export interface TwoFactorInfo {
  enabled: boolean
  secret?: string
  enabledAt?: Date
}

export interface UserPreferences {
  fontSize: 'compact' | 'default' | 'large'
}

export interface DigitalSignatureInfo {
  certificateDn?: string // Distinguished Name của chứng thư số
  serialNumber?: string // Số serial của chứng thư số
  validFrom?: Date // Ngày bắt đầu hiệu lực
  validTo?: Date // Ngày hết hạn hiệu lực
  provider?: string // Nhà cung cấp dịch vụ (ví dụ: VNPT SmartCA)
  status: 'active' | 'suspended' | 'expired' | 'revoked'
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
  phone!: string

  // ── SYSTEM ROLE & STATUS ──
  @Column({ type: 'string' })
  role!: 'tenant' | 'landlord' | 'staff' | 'admin'

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
}
