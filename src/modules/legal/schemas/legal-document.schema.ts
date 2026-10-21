import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type {
  DossierItem,
  ExecutionStep,
  LegalGround,
  LegalSourceIcon,
  LegalSourceKind,
  PropertyScope,
  RegulationCategory,
  RegulationChecklistItem,
  RegulationSeverity,
} from '../utils/legal-sources.types'
import type {
  LegalDocCategory,
  LegalDocStatus,
} from '../utils/legal-knowledge.types'
import type {
  LegalTermsReviewStatus,
  LegalTermsSection,
} from './legal-terms-document.schema'
import type { LegalKnowledgeDoc } from './legal-knowledge-doc.schema'
import type { LegalSource } from './legal-source.schema'
import type { PlatformRegulation } from './platform-regulation.schema'
import type { LegalTermsDocument } from './legal-terms-document.schema'

/**
 * G-LEG: hợp nhất `LegalKnowledgeDoc` (kind='knowledge'), `LegalSource`
 * (kind='source'), `PlatformRegulation` (kind='regulation') và
 * `LegalTermsDocument` (kind='terms') vào MỘT collection `legal_documents`,
 * GIỮ `_id` cũ của từng bản ghi (migration 020).
 *
 * Mọi truy vấn PHẢI lọc `kind` (thường qua `LegalDocumentScope`). Vì
 * `LegalSource.kind` đã là loại nguồn (LegalSourceKind), phân loại đó lưu ở
 * `docKind`; response vẫn trả `kind` cũ (xem `legal-document.mapper.ts`).
 *
 * Trường trùng tên giữa các loại dùng chung một cột: `category` (Doc và
 * Regulation dùng bộ giá trị khác nhau), `status`, `key` (Source và Terms),
 * `summary`, `updatedBy`, `createdBy`, `isActive`, `order`; ý nghĩa theo `kind`.
 *
 * Khóa duy nhất theo loại (không tạo được bằng decorator, do migration 020 tạo
 * bằng partial index): `key` UNIQUE khi `kind='source'`; `code` UNIQUE khi
 * `kind='regulation'`. Terms: `(key, version)` UNIQUE khi `kind='terms'` và
 * `status='published'` (migration 032); bản nháp và bản đã lưu trữ không bị ràng buộc.
 */
export const LEGAL_DOCUMENTS_COLLECTION = 'legal_documents'

export type LegalDocumentKind = 'knowledge' | 'source' | 'terms' | 'regulation'

export const LEGAL_DOCUMENT_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
  options: Record<string, unknown>
}> = [
  {
    name: 'legal_documents_kind_created_at',
    keys: { kind: 1, createdAt: -1 },
    options: {},
  },
  {
    name: 'legal_documents_kind_status_created_at',
    keys: { kind: 1, status: 1, createdAt: -1 },
    options: {},
  },
  {
    name: 'legal_documents_kind_key',
    keys: { kind: 1, key: 1 },
    options: {},
  },
  {
    name: 'legal_documents_kind_order',
    keys: { kind: 1, order: 1 },
    options: {},
  },
  {
    name: 'legal_documents_kind_linked_source_key',
    keys: { kind: 1, linkedSourceKey: 1 },
    options: {},
  },
  {
    name: 'legal_documents_terms_key_status_version',
    keys: { kind: 1, key: 1, status: 1, version: 1 },
    options: {},
  },
  {
    name: 'legal_documents_source_key_unique',
    keys: { key: 1 },
    options: { unique: true, partialFilterExpression: { kind: 'source' } },
  },
  {
    name: 'legal_documents_regulation_code_unique',
    keys: { code: 1 },
    options: { unique: true, partialFilterExpression: { kind: 'regulation' } },
  },
  {
    name: 'legal_documents_terms_key_version_published_unique',
    keys: { key: 1, version: 1 },
    options: {
      unique: true,
      partialFilterExpression: { kind: 'terms', status: 'published' },
    },
  },
]

@Entity(LEGAL_DOCUMENTS_COLLECTION)
export class LegalDocument {
  @ObjectIdColumn()
  _id!: ObjectId

  /** Phân loại bản ghi; mọi truy vấn bắt buộc lọc theo kind. */
  @Column({ type: 'string' })
  kind!: LegalDocumentKind

  @Column()
  title!: string

  // --- kind='knowledge' ---

  @Column({ nullable: true })
  category?: LegalDocCategory | RegulationCategory | undefined

  @Column({ nullable: true })
  docNumber?: string | undefined

  @Column({ nullable: true })
  issuer?: string | undefined

  @Column({ nullable: true })
  sourceUrl?: string | undefined

  @Column('array', { default: [] })
  keywords?: string[] | undefined

  @Column({ nullable: true })
  content?: string | undefined

  @Column({ nullable: true })
  contentSource?: 'link' | 'manual' | undefined

  @Column({ nullable: true })
  fetchedAt?: Date | undefined

  @Column({ nullable: true })
  effectiveDate?: Date | undefined

  /** From this moment the text no longer applies (repealed / replaced): it leaves the search index. */
  @Column({ nullable: true })
  expiryDate?: Date | undefined

  @Column({ type: 'string', default: 'draft' })
  status!: LegalDocStatus

  @Column({ default: 0 })
  chunkCount?: number | undefined

  // --- kind='source' ---

  /** LegalSourceKind (thủ tục / văn bản pháp luật); tên `kind` cũ của LegalSource. */
  @Column({ nullable: true })
  docKind?: LegalSourceKind | undefined

  /** Định danh ổn định của nguồn (kind='source') hoặc khóa liên kết của Terms (kind='terms'). */
  @Column({ nullable: true })
  key?: string | undefined

  @Column({ nullable: true })
  code?: string | undefined

  @Column({ nullable: true })
  subtitle?: string | undefined

  @Column({ nullable: true })
  agency?: string | undefined

  @Column({ nullable: true })
  duration?: string | undefined

  @Column({ nullable: true })
  fee?: string | undefined

  @Column({ nullable: true })
  externalUrl?: string | undefined

  @Column({ nullable: true })
  icon?: LegalSourceIcon | undefined

  @Column({ nullable: true })
  description?: string | undefined

  @Column({ nullable: true })
  dossierItems?: DossierItem[] | undefined

  @Column({ nullable: true })
  steps?: ExecutionStep[] | undefined

  @Column({ nullable: true })
  legalGrounds?: LegalGround[] | undefined

  @Column({ nullable: true })
  notes?: string[] | undefined

  @Column({ default: false })
  showInContractPanel?: boolean | undefined

  // --- kind='regulation' ---

  @Column({ nullable: true })
  severity?: RegulationSeverity | undefined

  @Column({ nullable: true })
  scope?: PropertyScope[] | undefined

  /** `key` của LegalSource được quy định tham chiếu. */
  @Column({ nullable: true })
  linkedSourceKey?: string | null | undefined

  @Column({ nullable: true })
  checklistItems?: RegulationChecklistItem[] | undefined

  @Column({ default: false })
  isDefault?: boolean | undefined

  // --- chung source / regulation ---

  @Column({ nullable: true })
  order?: number | undefined

  @Column({ default: true })
  isActive?: boolean | undefined

  // --- kind='terms' ---

  @Column({ nullable: true })
  version?: number | undefined

  @Column({ nullable: true })
  summary?: string | undefined

  @Column('json', { nullable: true })
  sections?: LegalTermsSection[] | undefined

  @Column({ nullable: true })
  contentHash?: string | undefined

  @Column({ default: 1 })
  draftRevision?: number | undefined

  /** Bản nháp: trạng thái duyệt hai bước (vắng mặt = 'editing'). */
  @Column({ nullable: true })
  reviewStatus?: LegalTermsReviewStatus | undefined

  @Column({ nullable: true })
  submittedBy?: string | undefined

  @Column({ nullable: true })
  submittedAt?: Date | undefined

  @Column({ nullable: true })
  reviewedBy?: string | undefined

  @Column({ nullable: true })
  reviewedAt?: Date | undefined

  @Column({ nullable: true })
  reviewNote?: string | undefined

  /** Bản đã công bố: thời điểm có hiệu lực; vắng mặt/null = hiệu lực từ publishedAt. */
  @Column({ nullable: true })
  effectiveFrom?: Date | null | undefined

  // --- chung ---

  @Column({ nullable: true })
  createdBy?: string | undefined

  @Column({ nullable: true })
  updatedBy?: string | undefined

  @Column({ nullable: true })
  publishedBy?: string | undefined

  @Column({ nullable: true })
  publishedAt?: Date | undefined

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}

/** Bản ghi kind='knowledge' với các trường đã chắc chắn có (hình `LegalKnowledgeDoc`). */
export type KnowledgeLegalDocument = LegalDocument &
  Pick<
    LegalKnowledgeDoc,
    | 'title'
    | 'category'
    | 'docNumber'
    | 'issuer'
    | 'sourceUrl'
    | 'keywords'
    | 'content'
    | 'summary'
    | 'contentSource'
    | 'fetchedAt'
    | 'effectiveDate'
    | 'expiryDate'
    | 'status'
    | 'chunkCount'
    | 'createdBy'
  > & { kind: 'knowledge' }

/** Bản ghi kind='source' (hình `LegalSource`; `kind` cũ nằm ở `docKind`). */
export type SourceLegalDocument = LegalDocument &
  Pick<
    LegalSource,
    | 'key'
    | 'code'
    | 'title'
    | 'subtitle'
    | 'agency'
    | 'duration'
    | 'fee'
    | 'externalUrl'
    | 'icon'
    | 'description'
    | 'dossierItems'
    | 'steps'
    | 'legalGrounds'
    | 'notes'
    | 'showInContractPanel'
    | 'order'
    | 'isActive'
    | 'updatedBy'
  > & { kind: 'source'; docKind: LegalSourceKind }

/** Bản ghi kind='regulation' (hình `PlatformRegulation`). */
export type RegulationLegalDocument = LegalDocument &
  Pick<
    PlatformRegulation,
    | 'code'
    | 'title'
    | 'summary'
    | 'category'
    | 'severity'
    | 'scope'
    | 'linkedSourceKey'
    | 'checklistItems'
    | 'order'
    | 'isActive'
    | 'isDefault'
    | 'updatedBy'
  > & { kind: 'regulation' }

/** Bản ghi kind='terms' (hình `LegalTermsDocument`). */
export type TermsLegalDocument = LegalDocument &
  Pick<
    LegalTermsDocument,
    | 'key'
    | 'version'
    | 'title'
    | 'summary'
    | 'sections'
    | 'contentHash'
    | 'status'
    | 'draftRevision'
    | 'createdBy'
    | 'updatedBy'
    | 'publishedBy'
    | 'publishedAt'
  > & { kind: 'terms' }
