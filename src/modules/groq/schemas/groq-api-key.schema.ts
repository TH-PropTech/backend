import { Entity, ObjectIdColumn, ObjectId, Column } from 'typeorm'
import type { CheckResult } from '../groq-probe'

export type GroqKeyStatus = 'active' | 'invalid' | 'disabled'

@Entity('groq_api_keys')
export class GroqApiKey {
  @ObjectIdColumn()
  _id!: ObjectId

  /** AES-256-GCM ciphertext of the raw key (see groq-key-crypto.ts). */
  @Column()
  keyEnc!: string

  /** HMAC fingerprint of the raw key; unique, used for dedupe and lookup. */
  @Column({ unique: true })
  keyHash!: string

  /** Display mask, e.g. "gsk_abcd...wxyz". */
  @Column()
  keyMask!: string

  @Column({ type: 'string', default: 'active' })
  status!: GroqKeyStatus

  /** Epoch ms; 0 means ready. */
  @Column({ default: 0 })
  cooldownUntil!: number

  @Column({ default: 0 })
  usageCount!: number

  @Column({ default: 0 })
  failCount!: number

  /** Epoch ms of the last time the key was handed out. */
  @Column({ default: 0 })
  lastUsedAt!: number

  @Column({ nullable: true })
  lastError?: string

  /** Epoch ms of creation; used as the FIFO order for picking keys. */
  @Column()
  createdAt!: number

  /** Result of the most recent probe, saved by an admin check. */
  @Column({ type: 'json', nullable: true })
  check?: CheckResult
}
