import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'
import { OtpActionType } from '../enums/otp-action-type.enum'
import { OtpSessionStatus } from '../enums/otp-session-status.enum'

/** Phân loại OTP: mọi truy vấn bắt buộc lọc theo kind. */
export type OtpKind = 'email' | 'transaction'

/** Hành động của OTP email (đăng ký / quên mật khẩu / đăng nhập). */
export type EmailOtpAction = 'login' | 'forgot-password' | 'signup'

/**
 * OTP hợp nhất: EmailOtp (kind 'email') và TransactionOtp (kind 'transaction');
 * giữ `_id` cũ (migration 021) vì `Contract.otpSessionId` lưu id phiên giao dịch.
 *
 * Trường chung: `otpCode`, `action`, `expiredAt`. Trường riêng của từng loại là
 * tùy chọn; mọi truy vấn đi qua `KindScopedOtpRepository` để tự thêm `kind`.
 * Không có `DEFAULT` trên trường dùng chung, để bản ghi email không bị thêm
 * trường giao dịch (và ngược lại).
 *
 * Chỉ mục: `(kind, email, otpCode, action, isUsed)` cho luồng email (migration
 * 021 tạo đúng tên này khi áp dụng). Phiên giao dịch chỉ tra theo `_id`.
 */
export const OTPS_COLLECTION = 'otps'

@Entity(OTPS_COLLECTION)
@Index('otps_kind_email_otp_code_action_used', [
  'kind',
  'email',
  'otpCode',
  'action',
  'isUsed',
])
export class Otp {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ type: 'string' })
  kind!: OtpKind

  @Column({ type: 'string' })
  otpCode!: string

  /** Email: EmailOtpAction; giao dịch: OtpActionType. */
  @Column({ type: 'string' })
  action!: string

  @Column()
  expiredAt!: Date

  // --- Trường riêng của kind='email' ---

  @Column({ nullable: true })
  email?: string

  @Column({ nullable: true })
  isUsed?: boolean

  // --- Trường riêng của kind='transaction' ---

  @Column({ nullable: true })
  userId?: string

  @Column({ nullable: true })
  deviceId?: string

  @Column({ nullable: true })
  challenge?: string

  @Column({ type: 'string', nullable: true })
  status?: string

  @Column({ nullable: true })
  attempts?: number

  @Column({ nullable: true })
  maxAttempts?: number

  @Column({ nullable: true })
  contractId?: string | null

  @Column({ nullable: true })
  signerRole?: string | null

  @Column({ nullable: true })
  contentLockedHash?: string | null

  @Column({ nullable: true })
  contextHash?: string | null

  @Column({ nullable: true })
  consumedAt?: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}

/** Bản ghi OTP email với các trường bắt buộc của hình `EmailOtp` cũ. */
export type EmailOtpRecord = Otp & {
  kind: 'email'
  email: string
  action: EmailOtpAction
  isUsed: boolean
}

/** Bản ghi phiên giao dịch với các trường bắt buộc của hình `TransactionOtp` cũ. */
export type TransactionOtpRecord = Otp & {
  kind: 'transaction'
  action: OtpActionType
  userId: string
  deviceId: string
  challenge: string
  status: OtpSessionStatus
  attempts: number
  maxAttempts: number
  contractId: string | null
  signerRole: string | null
  contentLockedHash: string | null
  contextHash: string | null
  consumedAt: Date | null
}
