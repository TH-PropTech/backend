import { Entity, ObjectIdColumn, ObjectId, Column, CreateDateColumn } from 'typeorm'

@Entity('notifications')
export class Notification {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: string

  @Column()
  title!: string

  @Column()
  body!: string

  @Column()
  type!: string

  @Column({ default: false })
  isRead!: boolean

  @Column()
  data!: Record<string, unknown>

  @CreateDateColumn()
  createdAt!: Date
}
