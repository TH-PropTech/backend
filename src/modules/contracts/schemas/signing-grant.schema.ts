import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
} from 'typeorm'
import type { SigningRole } from '../signing-grant.util'

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
