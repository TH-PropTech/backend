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

export const CONTRACT_LAYOUT_BLOCK_IDS = [
  'HEADER',
  'PARTIES',
  'PROPERTY',
  'COMMERCIAL_TERMS',
  'PAYMENT_SCHEDULE',
  'DEPOSIT_TERMS',
  'FEES',
  'SETTLEMENT',
  'LEGAL_ARTICLES',
  'SUPPLEMENTARY_CLAUSES',
  'ANNEXES',
  'DISCLOSURES',
  'SIGNATURES',
  'LEDGER_EVIDENCE',
] as const

export type ContractLayoutBlockId = (typeof CONTRACT_LAYOUT_BLOCK_IDS)[number]
export type ContractLayoutStatus = 'draft' | 'published' | 'archived'

export const LAYOUT_FIELD_KEYS = [
  'PARTIES.tenantName',
  'PARTIES.tenantCccdMasked',
  'PARTIES.landlordName',
  'PARTIES.landlordCccdMasked',
  'PROPERTY.address',
  'PROPERTY.apartmentCode',
  'COMMERCIAL_TERMS.monthlyRent',
  'COMMERCIAL_TERMS.durationMonths',
  'COMMERCIAL_TERMS.startDate',
  'COMMERCIAL_TERMS.endDate',
  'PAYMENT_SCHEDULE.items',
  'DEPOSIT_TERMS.amount',
  'FEES.items',
  'SETTLEMENT.items',
] as const

export type LayoutFieldKey = (typeof LAYOUT_FIELD_KEYS)[number]

export type ContractLayoutField = {
  fieldKey: LayoutFieldKey
  label: string
  visible: boolean
}

export type ContractLayoutBlock = {
  blockId: ContractLayoutBlockId
  order: number
  title: string
  visible: boolean
  fields?: ContractLayoutField[]
}

export type ContractLayoutSupplementaryClause = {
  id: string
  title: string
  content: string
  enabled: boolean
}

export type ContractLayoutDisclosure = {
  id: string
  title: string
  content: string
}

/**
 * @deprecated G-LAY: layout nằm trong `contract_templates` (kind='layout'), xem
 * `ContractTemplate` và `layout/contract-layout.mapper.ts`. Không còn đăng ký trong
 * `forFeature`; giữ class/collection cũ để migration 025 đọc và rollback.
 */
@Entity('contract_layout_profiles')
@Index(['profileKey', 'version'], { unique: true })
@Index(['profileKey', 'status'])
@Index(['legalProfile', 'status', 'templateKey'])
export class ContractLayoutProfile {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  profileKey!: string

  @Column()
  version!: number

  @Column({ type: 'string', default: 'draft' })
  status!: ContractLayoutStatus

  @Column()
  legalProfile!: LegalProfile

  @Column({ nullable: true })
  templateKey?: string | null

  @Column('json')
  blocks!: ContractLayoutBlock[]

  @Column('json')
  supplementaryClauses!: ContractLayoutSupplementaryClause[]

  @Column('json')
  disclosures!: ContractLayoutDisclosure[]

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
