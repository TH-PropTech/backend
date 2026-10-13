import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

/** Cấu hình bật/tắt của từng job nền. Không có bản ghi nghĩa là enabled. */
@Entity('job_configs')
@Index(['jobName'], { unique: true })
export class JobConfig {
  @ObjectIdColumn() _id!: ObjectId
  @Column() jobName!: string
  @Column({ default: true }) enabled!: boolean
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
