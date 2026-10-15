import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'
import type { SigningRole } from '../utils/signing-grant.util'

/**
 * `session`: phiên giao dịch với nhà cung cấp SmartCA (trường `providerTransactionId`).
 * `grant`: vé ký một lần phát hành trước khi ký (gộp từ `SigningGrant`, migration 028).
 */
export type SmartCaSigningSessionKind = 'session' | 'grant'

/**
 * SmartCaSigningSession hợp nhất (G-GRT): giữ `_id` cũ của phiên và của grant.
 * Mọi truy vấn đi qua `KindScopedSmartCaSigningRepository` để tự thêm `kind`.
 *
 * Unique không khai báo ở đây vì TypeORM Mongo không tạo được partial index:
 * `providerTransactionId` unique theo `kind='session'` và `tokenHash` unique theo
 * `kind='grant'` do migration 028 tạo khi áp dụng (production tắt synchronize).
 */
@Entity('smartca_signing_sessions')
@Index(['idempotencyKey'], { unique: true, sparse: true })
@Index('smartca_signing_sessions_kind_contract_signer_artifact_status', [
  'kind',
  'contractId',
  'signerId',
  'artifactHash',
  'status',
])
export class SmartCaSigningSession {
  @ObjectIdColumn() _id!: ObjectId
  @Column({ type: 'string' }) kind!: SmartCaSigningSessionKind
  @Column() contractId!: string
  @Column() signerId!: string
  @Column() signerRole!: 'tenant' | 'landlord'
  @Column() artifactHash!: string
  /** Chỉ có ở `kind='session'`. */
  @Column() providerTransactionId!: string
  @Column({ type: 'string', default: 'pending' })
  status!: 'pending' | 'signed' | 'rejected' | 'expired' | 'cancelled'
  @Column({ nullable: true }) idempotencyKey?: string | null
  @Column({ nullable: true }) confirmationUrl?: string | null
  @Column({ nullable: true }) certificateSerial?: string | null
  @Column({ nullable: true }) certificateSubject?: string | null
  @Column({ nullable: true }) certificateIssuer?: string | null
  @Column({ nullable: true }) signatureHash?: string | null
  @Column({ nullable: true }) signatureAlgorithm?: string | null
  @Column({ nullable: true }) signatureValueRef?: string | null
  @Column({ nullable: true }) signedAt?: Date | null
  @Column({ nullable: true }) verifiedAt?: Date | null
  @Column({ nullable: true }) providerStatus?: string | null
  @Column({ nullable: true }) documentId?: string | null
  /** Bản PDF đã ký (PAdES) đang chờ chữ ký của session này; null khi không bật PAdES. */
  @Column({ nullable: true }) signedArtifactId?: string | null

  // --- Trường riêng của kind='grant' (tùy chọn ở phiên) ---

  @Column({ nullable: true }) tokenHash?: string
  @Column({ nullable: true }) userId?: string
  @Column({ nullable: true }) role?: SigningRole
  @Column({ nullable: true }) contentLockedHash?: string
  @Column({ nullable: true }) biometricGrantId?: string
  @Column({ nullable: true }) otpSessionId?: string
  @Column({ nullable: true }) consumedAt?: Date | null

  @Column() expiresAt!: Date
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
