import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('apartments')
export class Apartment {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  title!: string

  @Column({ nullable: true })
  buildingId!: string | null

  @Column({ default: '', nullable: true })
  buildingName!: string | null

  @Column({ nullable: true })
  projectId!: string | null

  @Column({ default: '', nullable: true })
  projectName!: string | null

  @Column()
  category!: string

  @Column()
  description!: string

  @Column()
  location!: string

  @Column()
  city!: string

  @Column()
  district!: string

  @Column()
  ward!: string

  @Column()
  street!: string

  @Column()
  address!: string

  @Column()
  priceMonthly!: number

  @Column()
  area!: number

  @Column()
  bedrooms!: number

  @Column()
  bathrooms!: number

  @Column()
  direction!: string

  @Column()
  balconyDirection!: string

  @Column()
  furniture!: string

  @Column()
  moveInTime!: string

  @Column()
  electricity!: string

  @Column()
  water!: string

  @Column()
  internet!: string

  @Column('array')
  gallery!: string[]

  /** Danh sách ảnh 360 độ của căn hộ (ví dụ: 360 phòng khách, 360 phòng ngủ) */
  @Column('array')
  images360!: string[]

  @Column({ default: '' })
  vrUrl!: string

  @Column('array')
  amenities!: string[]

  @Column({ type: 'string', default: 'available' })
  status!: 'available' | 'pending' | 'updating' | 'unavailable'

  @Column({ default: false })
  isVerified!: boolean

  @Column()
  landlordId!: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
