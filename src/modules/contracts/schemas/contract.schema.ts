import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

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

  @Column({ type: 'string', default: 'awaiting-signature' })
  status!: 'awaiting-signature' | 'active' | 'terminated'

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

  // ── Timestamps ──

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
