import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

export type CommunityEntryKind = 'post' | 'comment'

/**
 * G-CMT: bài viết và bình luận cộng đồng trong một collection, phân biệt bằng
 * `kind`. `_id` giữ nguyên từ `community_posts` / `community_comments` nên
 * `postId`, `parentId`, `Notification.data.postId` vẫn đúng.
 * Mọi truy vấn PHẢI có điều kiện `kind`. Trường `kind` không lộ ra API.
 */
@Entity('community_entries')
// Tên chỉ mục phải trùng tên `createIndex` trong migration 009 (COMMUNITY_ENTRY_INDEXES).
@Index('community_entries_kind_post_created', ['kind', 'postId', 'createdAt'])
@Index('community_entries_kind_status_created', ['kind', 'status', 'createdAt'])
@Index('community_entries_kind_author_created', [
  'kind',
  'authorId',
  'createdAt',
])
export class CommunityEntry {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  kind!: CommunityEntryKind

  // ── Trường chung ──
  @Column()
  authorId!: string

  @Column()
  authorName!: string

  @Column({ default: 'tenant' })
  authorRole!: 'tenant' | 'landlord' | 'staff' | 'admin'

  @Column()
  content!: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date

  // ── Riêng bài viết (kind = 'post') ──
  @Column({ nullable: true })
  title?: string

  @Column({ nullable: true })
  projectName?: string

  @Column({ nullable: true })
  topic?: 'qa' | 'review' | 'roommate'

  @Column('array', { nullable: true })
  upvotes?: string[]

  @Column({ nullable: true })
  commentsCount?: number

  @Column('array', { nullable: true })
  images?: string[]

  @Column({ nullable: true })
  status?: 'pending' | 'approved' | 'rejected'

  @Column({ nullable: true })
  rejectReason?: string

  @Column('array', { nullable: true })
  tags?: string[]

  // ── Riêng bình luận (kind = 'comment') ──
  @Column({ nullable: true })
  postId?: string

  /** null nếu là bình luận gốc. */
  @Column({ nullable: true })
  parentId?: string | null
}

/** Union phân biệt theo `kind` cho lớp service. */
export type PostEntry = CommunityEntry & {
  kind: 'post'
  title: string
  projectName: string
  topic: 'qa' | 'review' | 'roommate'
  upvotes: string[]
  commentsCount: number
  images: string[]
  status: 'pending' | 'approved' | 'rejected'
  rejectReason?: string
  tags: string[]
}

export type CommentEntry = CommunityEntry & {
  kind: 'comment'
  postId: string
  parentId: string | null
}
