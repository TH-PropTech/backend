import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
} from 'typeorm'
import type { OwnershipTransferManifestEntityType } from '../utils/ownership-transfer.manifest'

export type OwnershipTransferRecordAction =
  | 'ownership-updated'
  | 'workflow-reassigned'
  | 'historical-linked'

@Entity('property_ownership_transfer_records')
@Index(['transferId', 'entityType', 'entityId'], { unique: true })
export class PropertyOwnershipTransferRecord {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  transferId!: string

  @Column({ type: 'string' })
  entityType!: OwnershipTransferManifestEntityType

  @Column()
  entityId!: string

  @Column({ type: 'string' })
  action!: OwnershipTransferRecordAction

  @Column({ nullable: true })
  fromLandlordId?: string | null

  @Column({ nullable: true })
  toLandlordId?: string | null

  @Column()
  beforeVersion!: string

  @Column({ nullable: true })
  afterVersion?: string | null

  @Column({ type: 'json' })
  metadata!: Record<string, string | number | boolean | null>

  @CreateDateColumn()
  createdAt!: Date
}
