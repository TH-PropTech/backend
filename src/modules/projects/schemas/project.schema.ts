import { Entity, ObjectIdColumn, ObjectId, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity('projects')
export class Project {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  name!: string

  @Column()
  description!: string

  @Column()
  location!: string

  @Column()
  city!: string

  @Column()
  district!: string

  @Column()
  investor!: string

  @Column('array')
  amenities!: string[]

  @Column('array')
  images!: string[]

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
