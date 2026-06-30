import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('kyc_records')
export class KycRecord {
  @ObjectIdColumn()
  _id!: ObjectId

  /** ID người dùng nộp hồ sơ KYC */
  @Column()
  userId!: string

  /** Số CCCD/CMND */
  @Column()
  idCardNumber!: string

  /** URL ảnh mặt trước CCCD */
  @Column()
  frontCardUrl!: string

  /** URL ảnh mặt sau CCCD */
  @Column()
  backCardUrl!: string

  /** URL ảnh selfie xác thực khuôn mặt */
  @Column()
  selfieUrl!: string

  /** Họ tên trích xuất từ OCR */
  @Column({ nullable: true })
  fullName?: string

  /** Ngày sinh trích xuất từ OCR */
  @Column({ nullable: true })
  dateOfBirth?: string

  /** Giới tính trích xuất từ OCR */
  @Column({ nullable: true })
  gender?: string

  /** Quốc tịch trích xuất từ OCR */
  @Column({ nullable: true })
  nationality?: string

  /** Quê quán trích xuất từ OCR */
  @Column({ nullable: true })
  placeOfOrigin?: string

  /** Nơi thường trú trích xuất từ OCR */
  @Column({ nullable: true })
  placeOfResidence?: string

  /** Tỷ lệ khớp OCR so với dữ liệu selfie (0-100) */
  @Column({ type: 'float', nullable: true })
  ocrMatchRate?: number

  /** Ngày cấp CCCD (trích xuất từ OCR mặt sau) */
  @Column({ nullable: true })
  issueDate?: string

  /** Nơi cấp CCCD (trích xuất từ OCR mặt sau) */
  @Column({ nullable: true })
  placeOfIssue?: string

  /** Kết quả so khớp khuôn mặt selfie vs CCCD */
  @Column({ nullable: true })
  faceMatchResult?: boolean

  /** Kết quả Liveness Detection (thật/giả) */
  @Column({ nullable: true })
  livenessResult?: boolean

  /** Điểm Anti-Spoofing (0.0 - 1.0) */
  @Column({ type: 'float', nullable: true })
  spoofScore?: number

  /**
   * Trạng thái KYC:
   * - pending: Đã nộp, chờ xử lý
   * - verified: Đã xác minh thành công
   * - rejected: Bị từ chối
   */
  @Column({ type: 'string', default: 'pending' })
  status!: 'pending' | 'verified' | 'rejected'

  /** Lý do từ chối (nếu có) */
  @Column({ nullable: true })
  rejectedReason!: string | null

  /** Thời điểm xác minh thành công */
  @Column({ nullable: true })
  verifiedAt!: Date | null

  /** ID nhân viên/admin đã duyệt (để audit trail) */
  @Column({ nullable: true })
  reviewedBy?: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
