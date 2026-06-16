import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('buildings')
export class Building {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  name!: string

  @Column({ nullable: true })
  projectId!: string | null

  @Column({ default: '', nullable: true })
  projectName!: string | null

  @Column({ nullable: true })
  description?: string

  @Column({ nullable: true })
  floorsCount?: number

  @Column({ nullable: true })
  location?: string

  @Column({ nullable: true })
  city?: string

  @Column({ nullable: true })
  district?: string

  @Column('array', { default: [] })
  amenities!: string[]

  @Column('array', { default: [] })
  images!: string[]

  @Column('array', { default: [] })
  images360!: string[]

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
