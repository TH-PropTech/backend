import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { LegalProfile } from '../legal/legal-profile.resolver'
import type {
  ContractLayoutBlock,
  ContractLayoutDisclosure,
  ContractLayoutSupplementaryClause,
} from './contract-layout-profile.schema'

/**
 * G-LAY: `contract_templates` gom thêm `ContractLayoutProfile` (kind='layout').
 * Trạng thái layout có thêm 'archived'.
 */
export type ContractTemplateStatus = 'draft' | 'published' | 'archived'

/** Trường phân loại: 'template' = mẫu hợp đồng, 'layout' = bố cục (ContractLayoutProfile cũ). */
export type ContractTemplateEntityKind = 'template' | 'layout'

export type ContractTemplateClause = {
  id?: string
  number: number
  heading: string
  content?: string
  variableRefs?: string[]
  contentHash: string
  citationIds: string[]
  protected: boolean
}

export type ContractTemplateAddendum = {
  id: string
  title: string
  content: string
  enabled: boolean
}

export type ContractTemplateAnnexDefinition = {
  id: string
  title: string
  description?: string
  required: boolean
  citationIds?: string[]
}

export type ContractTemplateReviewStatus =
  | 'draft'
  | 'reviewed'
  | 'published'
  | 'needs-review'

/**
 * G-LAY: gom `ContractLayoutProfile` vào cùng collection, phân biệt bằng `kind`
 * (migration 025). Mọi truy vấn PHẢI lọc `kind` qua `ContractTemplateKindRepository`
 * (xem `utils/contract-template-kind.repository.ts`); template cũ thiếu `kind`
 * được coi là 'template'.
 *
 * Trường riêng của kind='layout' (tùy chọn): `profileKey`, `blocks`,
 * `supplementaryClauses`, `disclosures`; khi đó `templateKey` là khóa mẫu được
 * áp dụng (có thể null = layout chung theo `legalProfile`), và các trường
 * template bắt buộc (clauses, addenda, ...) không có. Phản hồi layout ánh xạ
 * về hình `ContractLayoutProfile` cũ (không có `kind`), xem `layout/contract-layout.mapper.ts`.
 *
 * Chỉ mục: UNIQUE `(templateKey, version)` (kind='template') và UNIQUE
 * `(profileKey, version)` (kind='layout') là partial index; TypeORM Mongo không
 * tạo được partial index nên do migration 025 tạo (và gỡ unique cũ
 * `(templateKey, version)`). Không khai báo lại cùng bộ khóa ở đây để tránh xung đột tên chỉ mục.
 */
@Entity('contract_templates')
@Index(['templateKey', 'status'])
@Index(['legalProfile', 'status', 'effectiveFrom'])
export class ContractTemplate {
  @ObjectIdColumn()
  _id!: ObjectId

  /** Mặc định 'template' cho dữ liệu cũ (migration 025 backfill). */
  @Column({ type: 'string', default: 'template' })
  kind!: ContractTemplateEntityKind

  /** kind='template': khóa mẫu. kind='layout': khóa mẫu áp dụng, có thể null. */
  @Column()
  templateKey!: string

  @Column()
  version!: number

  @Column({ type: 'string', default: 'draft' })
  status!: ContractTemplateStatus

  @Column()
  legalProfile!: LegalProfile

  // --- Trường riêng của kind='layout' (tùy chọn) ---

  /** Khóa layout (`profileKey` của ContractLayoutProfile cũ). */
  @Column({ nullable: true })
  profileKey?: string | null

  @Column('json', { nullable: true })
  blocks?: ContractLayoutBlock[]

  @Column('json', { nullable: true })
  supplementaryClauses?: ContractLayoutSupplementaryClause[]

  @Column('json', { nullable: true })
  disclosures?: ContractLayoutDisclosure[]

  // --- Trường riêng của kind='template' (bắt buộc với template) ---

  @Column('json')
  clauses!: ContractTemplateClause[]

  @Column({ default: 1 })
  schemaVersion!: number

  @Column({ nullable: true })
  effectiveFrom?: Date | null

  @Column({ default: false })
  referenceOnly!: boolean

  @Column({ type: 'string', default: 'draft' })
  reviewStatus!: ContractTemplateReviewStatus

  @Column({ nullable: true })
  reviewReference?: string | null

  @Column('json', { nullable: true })
  annexDefinitions?: ContractTemplateAnnexDefinition[] | null

  @Column('json')
  allowedVariables!: string[]

  @Column('json')
  addenda!: ContractTemplateAddendum[]

  @Column('json')
  citationIds!: string[]

  @Column()
  contentHash!: string

  @Column({ default: 1 })
  draftRevision!: number

  @Column()
  createdBy!: string

  @Column({ nullable: true })
  updatedBy?: string | null

  @Column({ nullable: true })
  publishedBy?: string | null

  @Column({ nullable: true })
  publishedAt?: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
