import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

/** Nhật ký thao tác của người dùng (staff/admin...) trên API ghi dữ liệu. */
@Entity('activity_logs')
@Index(['createdAt'])
@Index(['userId', 'createdAt'])
export class ActivityLog {
  @ObjectIdColumn() _id!: ObjectId

  /** _id của user thực hiện hành động */
  @Column() userId!: string

  /** Vai trò của user tại thời điểm thao tác */
  @Column() userRole!: string

  /** HTTP method: POST | PUT | PATCH | DELETE */
  @Column() method!: string

  /** Đường dẫn endpoint, ví dụ /api/v1/admin/rental-flow/profiles */
  @Column() path!: string

  /** Mô tả hành động ngắn gọn */
  @Column() action!: string

  @Column({ nullable: true }) statusCode?: number

  /** Body gửi lên (đã loại bỏ trường nhạy cảm) */
  @Column({ nullable: true }) requestBody?: Record<string, unknown>

  @Column({ nullable: true }) responseMessage?: string
  @Column({ nullable: true }) ip?: string
  @Column({ nullable: true }) userAgent?: string

  /** Đối tượng bị tác động */
  @Column({ nullable: true }) targetInfo?: Record<string, unknown>

  /** Thời gian xử lý (ms) */
  @Column({ nullable: true }) duration?: number

  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
