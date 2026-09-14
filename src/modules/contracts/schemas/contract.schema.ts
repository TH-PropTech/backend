import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { RentalPackageSnapshot } from '../../apartments/rental-package.util'

export type ContractSignature = {
  signerId: string
  role: 'tenant' | 'landlord'
  signedAt: Date
  contentHash: string
  biometricGrantId: string
  otpSessionId: string
  deviceId?: string | null
}

@Entity('contracts')
export class Contract {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ unique: true })
  contractCode!: string

  // ── Thông tin tài sản ──

  @Column()
  propertyId!: string

  @Column()
  propertyTitle!: string

  /** Địa chỉ chi tiết của căn hộ */
  @Column({ nullable: true })
  propertyAddress!: string | null

  /** Diện tích sử dụng (m2) */
  @Column({ nullable: true })
  propertyArea!: number | null

  /** Hiện trạng nội thất bàn giao */
  @Column({ nullable: true })
  propertyFurniture!: string | null

  /** Giá trị tài sản/giá cho thuê tổng — dùng để tính tỷ lệ cọc theo Điều 23 LKDBDS 2023 */
  @Column()
  propertyValue!: number

  // ── Các bên tham gia (Thông tin pháp lý) ──

  @Column()
  landlordId!: string

  @Column({ nullable: true })
  landlordName!: string | null

  @Column({ nullable: true })
  landlordCccd!: string | null

  @Column({ nullable: true })
  landlordAddress!: string | null

  @Column()
  tenantId!: string

  @Column({ nullable: true })
  tenantName!: string | null

  @Column({ nullable: true })
  tenantCccd!: string | null

  @Column({ nullable: true })
  tenantAddress!: string | null

  // ── Thời hạn hợp đồng ──

  @Column()
  startDate!: Date

  @Column()
  endDate!: Date

  @Column({ nullable: true })
  durationMonths?: number | null

  // ── Tài chính ──

  @Column()
  monthlyRent!: number

  @Column()
  deposit!: number

  @Column()
  paymentDay!: number

  /** Lãi suất phạt chậm đóng (%/năm) — validate với MAX_LATE_PAYMENT_INTEREST_RATE_YEAR */
  @Column()
  latePenaltyRate!: number

  // ── Điều khoản chấm dứt ──

  /** Số ngày báo trước khi đơn phương chấm dứt — validate với MIN_TERMINATION_NOTICE_DAYS */
  @Column()
  terminationNoticeDays!: number

  // ── Trạng thái ký kết ──

  @Column({ type: 'string', default: 'draft' })
  status?:
    | 'draft'
    | 'deposit-pending'
    | 'deposit-paid'
    | 'awaiting-signature'
    | 'active'
    | 'terminated'
    | 'cancelled'
    | 'completed'

  @Column({ nullable: true })
  legacyFlow?: boolean | null

  @Column({ default: false })
  signedByTenant!: boolean

  @Column({ default: false })
  signedByLandlord!: boolean

  // ── Blockchain & Chính sách lai ──

  /** Mã băm SHA-256 nội dung hợp đồng — đẩy lên Fabric khi ký */
  @Column({ nullable: true })
  contractHash!: string | null

  /** Địa chỉ giao dịch trên Blockchain Fabric */
  @Column({ nullable: true })
  blockchainAddress!: string | null

  /**
   * Snapshot chính sách pháp luật áp dụng tại thời điểm ký.
   * Khi hợp đồng active, các giá trị này được "đóng băng" và đẩy lên blockchain,
   * đảm bảo dù policies trong MongoDB thay đổi sau này,
   * hợp đồng cũ vẫn chạy theo luật lúc ký.
   */
  @Column({ nullable: true })
  appliedPolicies!: Record<string, string> | null

  @Column({ nullable: true })
  rentalApplicationId?: string | null

  @Column({ nullable: true })
  depositAgreementId?: string | null

  @Column({ nullable: true })
  depositId?: string | null

  @Column({ nullable: true })
  depositPaidAt?: Date | null

  @Column({ nullable: true })
  depositTxHash?: string | null

  @Column({ nullable: true })
  depositAgreementCode?: string | null

  @Column({ nullable: true })
  terminatedAt?: Date | null

  @Column({ nullable: true })
  terminationReason?: string | null

  @Column({ nullable: true })
  terminationReasonCode?: string | null

  @Column({ nullable: true })
  terminationIdempotencyKey?: string | null

  @Column({ nullable: true })
  terminatedBy?: string | null

  @Column({ nullable: true })
  terminationTxHash?: string | null

  @Column({ nullable: true })
  packageSnapshot?: RentalPackageSnapshot | null

  @Column({ nullable: true })
  applicationReviewHash?: string | null

  @Column({ nullable: true })
  termsRef?: {
    key: string
    version: number
    contentHash: string
  } | null

  @Column({ nullable: true })
  flowProfileRef?: {
    profileId: string
    version: number
    hash: string
  } | null

  @Column({ nullable: true })
  configStatus?: 'CURRENT' | 'CONFIG_OUTDATED' | null

  @Column({ nullable: true })
  contentRevision?: number | null

  @Column({ nullable: true })
  editorContent?: Record<string, unknown> | null

  @Column({ nullable: true })
  contentLockedHash?: string | null

  @Column({ nullable: true })
  contentLockedAt?: Date | null

  @Column({ nullable: true })
  hashSchemaVersion?: number | null

  @Column({ nullable: true })
  activationKey?: string | null

  @Column({ nullable: true })
  tenantSignature?: ContractSignature | null

  @Column({ nullable: true })
  landlordSignature?: ContractSignature | null

  @Column({ type: 'string', default: 'POC_ECONSENT' })
  executionMethod?: 'WET_INK' | 'QUALIFIED_DIGITAL_SIGNATURE' | 'POC_ECONSENT'

  @Column({ type: 'string', default: 'not-requested' })
  notarizationStatus?:
    | 'not-requested'
    | 'pending'
    | 'notarized'
    | 'authenticated'
    | 'rejected'

  // ── Timestamps ──

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
