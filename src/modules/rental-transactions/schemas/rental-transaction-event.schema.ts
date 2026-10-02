import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
} from 'typeorm'

export type RentalTransactionActorRole =
  | 'tenant'
  | 'landlord'
  | 'staff'
  | 'admin'
  | 'system'
  | 'provider'

@Entity('rental_transaction_events')
@Index(['transitionKey'], { unique: true })
@Index(['applicationId', 'occurredAt'])
@Index(['contractId', 'occurredAt'])
export class RentalTransactionEvent {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ nullable: true })
  applicationId?: string | null

  @Column({ nullable: true })
  contractId?: string | null

  @Column()
  eventType!: string

  @Column({ type: 'string' })
  actorRole!: RentalTransactionActorRole

  @Column({ nullable: true })
  actorId?: string | null

  @Column({ nullable: true })
  reasonCode?: string | null

  @Column('json')
  refs!: Record<string, string>

  @Column()
  transactionKey!: string

  @Column()
  transitionKey!: string

  @Column()
  occurredAt!: Date

  @CreateDateColumn()
  createdAt!: Date
}
