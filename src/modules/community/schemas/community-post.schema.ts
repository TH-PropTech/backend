import { Entity, ObjectIdColumn, ObjectId, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity('community_posts')
export class CommunityPost {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  authorId!: string

  @Column()
  authorName!: string

  @Column()
  title!: string

  @Column()
  content!: string

  @Column('array')
  tags!: string[]

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
