import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'
import type {
  PropertyScope,
  RegulationCategory,
  RegulationChecklistItem,
  RegulationSeverity,
} from '../utils/legal-sources.types'

/**
 * @deprecated G-LEG: dữ liệu nay nằm ở `LegalDocument{kind:'regulation'}`
 * (collection `legal_documents`). Giữ lại làm kiểu hình và để migration 020 /
 * rollback tham chiếu collection cũ `platform_regulations`; entity này KHÔNG còn
 * nằm trong `TypeOrmModule.forFeature`.
 *
 * Quy định nền tảng do Admin quản trị, có thể liên kết tới một nguồn pháp lý
 */
@Entity('platform_regulations')
@Index(['code'], { unique: true })
export class PlatformRegulation {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  code!: string

  @Column()
  title!: string

  @Column()
  summary!: string

  @Column()
  category!: RegulationCategory

  @Column()
  severity!: RegulationSeverity

  @Column()
  scope!: PropertyScope[]

  /** `key` của LegalSource được tham chiếu */
  @Column({ nullable: true })
  linkedSourceKey?: string | null

  @Column()
  checklistItems!: RegulationChecklistItem[]

  @Column()
  order!: number

  @Column({ default: true })
  isActive!: boolean

  @Column({ default: false })
  isDefault!: boolean

  @Column({ nullable: true })
  updatedBy?: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
