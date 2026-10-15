import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import { RBAC_ACTIONS, RBAC_SUBJECTS } from '../rbac.constants'

/**
 * Quyền nhúng trong `Role.permissions[]`: (action, subject) được phép hoặc bị từ chối.
 * Khử trùng (action, subject) làm trong mã (không còn unique ở DB).
 */
export interface RolePermission {
  /** `_id` cũ của bản ghi `permissions` (giữ nguyên qua migration). */
  _id: ObjectId
  action: string
  subject: string
  allowed: boolean
  createdAt: Date
  updatedAt: Date
}

/** Hình trả về của `GET/PUT /rbac/roles/:id/permissions` (giữ như trước khi nhúng). */
export interface RolePermissionView {
  _id: ObjectId
  roleId: string
  action: string
  subject: string
  allowed: boolean
  createdAt: Date
  updatedAt: Date
}

/** Trần số quyền của một role: mỗi (action, subject) tối đa một lần. */
export const MAX_ROLE_PERMISSIONS = RBAC_ACTIONS.length * RBAC_SUBJECTS.length

/** Vai trò lưu DB (tenant | landlord | staff | admin + role tự tạo). */
@Entity('roles')
@Index(['name'], { unique: true })
export class Role {
  @ObjectIdColumn() _id!: ObjectId
  @Column() name!: string
  @Column({ default: '' }) description!: string
  @Column({ default: true }) isActive!: boolean
  /** Role mặc định do seed tạo ra: không được xóa hoặc đổi tên */
  @Column({ default: false }) isSystem!: boolean
  /**
   * Quyền nhúng. Ghi bằng `updateOne` ($set toàn mảng khi PUT); KHÔNG `save(role)`
   * toàn document khi đang giữ bản nạp cũ. Role cũ chưa có trường này: coi như [].
   */
  @Column('array', { nullable: true })
  permissions!: RolePermission[]
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}

/** Role không kèm `permissions` (hình trả về của `GET /rbac/roles*`). */
export type RoleView = Omit<Role, 'permissions'>
