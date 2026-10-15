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
  DossierItem,
  ExecutionStep,
  LegalGround,
  LegalSourceIcon,
  LegalSourceKind,
} from '../utils/legal-sources.types'

/**
 * @deprecated G-LEG: dữ liệu nay nằm ở `LegalDocument{kind:'source'}`
 * (collection `legal_documents`, `kind` cũ nằm ở `docKind`). Giữ lại làm kiểu hình
 * và để migration 020 / rollback tham chiếu collection cũ `legal_sources`; entity
 * này KHÔNG còn nằm trong `TypeOrmModule.forFeature`.
 *
 * Nguồn pháp lý / thủ tục Dịch vụ công hiển thị trên contract workspace
 * và được Admin quản trị.
 */
@Entity('legal_sources')
@Index(['key'], { unique: true })
export class LegalSource {
  @ObjectIdColumn()
  _id!: ObjectId

  /** Định danh ổn định, bất biến sau khi tạo (vd `1.004194`, `housing-law-2023`) */
  @Column()
  key!: string

  @Column()
  kind!: LegalSourceKind

  @Column()
  code!: string

  @Column()
  title!: string

  @Column()
  subtitle!: string

  @Column()
  agency!: string

  @Column()
  duration!: string

  @Column()
  fee!: string

  @Column()
  externalUrl!: string

  @Column()
  icon!: LegalSourceIcon

  @Column()
  description!: string

  @Column()
  dossierItems!: DossierItem[]

  @Column()
  steps!: ExecutionStep[]

  @Column()
  legalGrounds!: LegalGround[]

  @Column()
  notes!: string[]

  @Column({ default: false })
  showInContractPanel!: boolean

  @Column()
  order!: number

  @Column({ default: true })
  isActive!: boolean

  @Column({ nullable: true })
  updatedBy?: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
