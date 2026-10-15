import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
} from 'typeorm'
import type { SigningRole } from '../utils/signing-grant.util'

/**
 * @deprecated G-GRT: grant đã gộp vào `SmartCaSigningSession` (`kind='grant'`,
 * migration 028). Không còn trong `forFeature`; giữ file để tham chiếu lịch sử.
 */
@Entity('signing_grants')
export class SigningGrant {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ unique: true })
  tokenHash!: string

  @Column()
  userId!: string

  @Column()
  role!: SigningRole

  @Column()
  contractId!: string

  @Column()
  contentLockedHash!: string

  @Column()
  biometricGrantId!: string

  @Column()
  otpSessionId!: string

  @Column()
  expiresAt!: Date

  @Column({ nullable: true })
  consumedAt!: Date | null

  @CreateDateColumn()
  createdAt!: Date
}
