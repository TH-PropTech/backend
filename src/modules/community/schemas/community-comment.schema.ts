import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('community_comments')
export class CommunityComment {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  postId!: string

  @Column({ nullable: true })
  parentId!: string | null // NULL if it's a top-level comment, parentCommentId if nested

  @Column()
  authorId!: string

  @Column()
  authorName!: string

  @Column({ type: 'string' })
  authorRole!: 'tenant' | 'landlord' | 'staff'

  @Column()
  content!: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
