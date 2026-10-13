import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

/** Quyền của một role: (action, subject) được phép hoặc bị từ chối. */
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
