import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('viewing_notes')
export class ViewingNote {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: string

  @Column()
  apartmentId!: string

  @Column({ nullable: true, default: null })
  bookingId!: string | null

  @Column({ nullable: true, default: null })
  noise!: number | null

  @Column({ nullable: true, default: null })
  lighting!: number | null

  @Column({ nullable: true, default: null })
  smell!: string | null

  @Column({ nullable: true, default: null })
  signal!: number | null

  @Column({ nullable: true, default: null })
  waterPressure!: number | null

  @Column({ nullable: true, default: null })
  parking!: number | null

  @Column({ nullable: true, default: null })
  neighbors!: number | null

  @Column({ default: [] })
  extraFees!: string[]

  @Column({ default: [] })
  questions!: string[]

  @Column({ default: [] })
  photos!: string[]

  @Column({ default: true })
  isPrivate!: boolean

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
