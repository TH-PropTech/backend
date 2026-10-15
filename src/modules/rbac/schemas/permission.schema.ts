import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

/**
 * Quyền của một role: (action, subject) được phép hoặc bị từ chối.
 * @deprecated Đã nhúng vào `Role.permissions[]` (xem `role.schema.ts`, migration 019).
 * Không còn đăng ký trong `TypeOrmModule.forFeature`; giữ file để tham chiếu và
 * rollback. Collection `permissions` cũ không bị xóa.
 */
@Entity('permissions')
@Index(['roleId', 'action', 'subject'], { unique: true })
export class Permission {
  @ObjectIdColumn() _id!: ObjectId
  /** `_id` (dạng chuỗi) của Role */
  @Column() roleId!: string
  /** manage | create | read | update | delete | approve */
  @Column() action!: string
  /** Tên đối tượng nghiệp vụ hoặc 'all' */
  @Column() subject!: string
  /** true = cho phép, false = từ chối */
  @Column({ default: true }) allowed!: boolean
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
