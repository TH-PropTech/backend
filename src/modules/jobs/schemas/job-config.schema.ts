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
 * Cấu hình bật/tắt của từng job nền. Không có bản ghi nghĩa là enabled.
 *
 * @deprecated G-CFG: thay bằng `SystemConfig{scope:'job', key:jobName}`
 * (`properties/schemas/system-config.schema.ts`). Giữ file để rollback/migration 013;
 * không đăng ký trong `forFeature`. Collection `job_configs` không bị xóa.
 */
@Entity('job_configs')
@Index(['jobName'], { unique: true })
export class JobConfig {
  @ObjectIdColumn() _id!: ObjectId
  @Column() jobName!: string
  @Column({ default: true }) enabled!: boolean
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
