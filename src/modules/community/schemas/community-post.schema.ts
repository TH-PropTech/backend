import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

/**
 * @deprecated G-CMT: gộp vào `CommunityEntry` (collection `community_entries`, `kind`).
 * Giữ lại để migration 009 đọc `community_posts` và làm kiểu phản hồi API.
 */
@Entity('community_posts')
export class CommunityPost {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  authorId!: string

  @Column()
  authorName!: string

  @Column({ default: 'tenant' })
  authorRole!: 'tenant' | 'landlord' | 'staff' | 'admin'

  @Column()
  title!: string

  @Column()
  content!: string

  @Column()
  projectName!: string

  @Column()
  topic!: 'qa' | 'review' | 'roommate'

  @Column('array', { default: [] })
  upvotes!: string[]

  @Column({ default: 0 })
  commentsCount!: number

  @Column('array', { default: [] })
  images!: string[]

  @Column({ default: 'pending' })
  status!: 'pending' | 'approved' | 'rejected'

  @Column({ nullable: true })
  rejectReason?: string

  @Column('array', { default: [] })
  tags!: string[]

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
