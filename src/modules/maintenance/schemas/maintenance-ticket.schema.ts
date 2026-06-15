import { Entity, ObjectIdColumn, ObjectId, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity('maintenance_tickets')
export class MaintenanceTicket {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  propertyId!: string

  @Column()
  propertyTitle!: string

  @Column()
  tenantId!: string

  @Column()
  description!: string

  @Column('array')
  images!: string[]

  @Column({ type: 'string', default: 'pending' })
  status!: 'pending' | 'in-progress' | 'resolved' | 'cancelled'

  @Column({ nullable: true })
  resolvedAt!: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
