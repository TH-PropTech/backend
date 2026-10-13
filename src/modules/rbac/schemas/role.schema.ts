import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

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
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
