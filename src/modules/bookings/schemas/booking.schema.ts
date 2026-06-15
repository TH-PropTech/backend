import { Entity, ObjectIdColumn, ObjectId, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity('bookings')
export class Booking {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  propertyId!: string

  @Column()
  propertyTitle!: string

  @Column()
  tenantId!: string

  @Column()
  visitAt!: Date

  @Column({ type: 'string' })
  method!: 'onsite' | 'video'

  @Column({ type: 'string', default: 'pending' })
  status!: 'pending' | 'confirmed' | 'rejected' | 'cancelled'

  @Column({ nullable: true })
  consultantId!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
