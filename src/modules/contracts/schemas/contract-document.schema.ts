import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { ContractArtifact } from './contract-artifact.schema'
import type { ContractSignedArtifact } from './contract-signed-artifact.schema'

export type ContractDocumentKind = 'canonical' | 'signed'

/**
 * G-DOC: gom `ContractArtifact` (kind='canonical', gồm cả artifact của bản sửa
 * đổi có `amendmentId`) và `ContractSignedArtifact` (kind='signed') vào MỘT
 * collection, GIỮ `_id` cũ của từng bản ghi (migration 011).
 *
 * Mọi truy vấn PHẢI lọc `kind`; phản hồi ánh xạ về hình cũ (không có `kind`),
 * xem `contract-document.mapper.ts`. Trường riêng của từng loại là tùy chọn.
 *
 * Chỉ mục:
 * - `(kind, contractId, revision)` thường (khai báo ở đây, TypeORM tạo được).
 * - UNIQUE `(contractId, revision, amendmentId)` CHỈ cho kind='canonical' là
 *   partial index (`partialFilterExpression`); TypeORM Mongo không tạo được
 *   partial index nên chỉ mục này do migration 011 tạo
 *   (`CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX`). Bản `signed` không có unique,
 *   giữ đúng hành vi cũ (revision tính latest+1, không nguyên tử).
 */
export const CONTRACT_DOCUMENTS_COLLECTION = 'contract_documents'

export const CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX = {
  name: 'contract_documents_canonical_contract_revision_amendment_unique',
  keys: { contractId: 1, revision: 1, amendmentId: 1 } as Record<
    string,
    1 | -1
  >,
  options: {
    unique: true,
    partialFilterExpression: { kind: 'canonical' },
  },
} as const

export const CONTRACT_DOCUMENT_KIND_REVISION_INDEX = {
  name: 'contract_documents_kind_contract_revision',
  keys: { kind: 1, contractId: 1, revision: 1 } as Record<string, 1 | -1>,
} as const

@Entity(CONTRACT_DOCUMENTS_COLLECTION)
// Tên trùng migration 011 (CONTRACT_DOCUMENT_INDEXES). Chỉ mục unique partial
// `contract_documents_canonical_contract_revision_amendment_unique` (partialFilterExpression)
// không khai báo ở đây; migration tạo nó.
@Index('contract_documents_kind_contract_revision', [
  'kind',
  'contractId',
  'revision',
])
export class ContractDocument {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ type: 'string' })
  kind!: ContractDocumentKind

  @Column()
  contractId!: string

  /** canonical: revision nội dung; signed: số thứ tự bản đã ký. */
  @Column()
  revision!: number

  /** canonical: SHA-256 của PDF canonical (`artifactHash`). */
  @Column({ nullable: true })
  artifactHash?: string

  // --- Trường riêng của kind='canonical' (tùy chọn) ---

  @Column('json')
  templateRef?: {
    key: string
    version: number
    contentHash: string
  }

  @Column({ nullable: true })
  legalProfile?: string

  @Column('objectId')
  gridFsFileId?: ObjectId

  @Column({ nullable: true })
  canonicalContentHash?: string | null

  @Column({ nullable: true })
  rendererVersion?: string | null

  @Column({ nullable: true })
  sourceSchemaVersion?: number | null

  @Column({ nullable: true })
  amendmentId?: string | null

  @Column({ nullable: true })
  contentType?: 'application/pdf'

  @Column({ nullable: true })
  lockedAt?: Date | null

  // --- Trường riêng của kind='signed' (tùy chọn) ---

  @Column({ nullable: true })
  signerId?: string

  @Column({ nullable: true })
  signerRole?: 'tenant' | 'landlord'

  /** Hash của canonical artifact mà bản đã ký này dựa trên. */
  @Column({ nullable: true })
  canonicalHash?: string

  @Column({ type: 'string', nullable: true })
  status?: 'prepared' | 'ready' | 'failed'

  @Column({ nullable: true })
  errorCode?: string | null

  @Column({ nullable: true })
  sessionId?: string | null

  /** PDF đã có placeholder và /ByteRange, đợi chữ ký. */
  @Column('objectId')
  preparedFileId?: ObjectId

  @Column({ nullable: true })
  contentDigest?: string

  @Column({ nullable: true })
  signedAttrsDigest?: string

  @Column({ nullable: true })
  signingTime?: Date

  /** Chứng thư công khai của người ký (không phải secret). */
  @Column({ nullable: true })
  signerPem?: string

  @Column('array')
  chainPem?: string[]

  @Column('objectId')
  signedFileId?: ObjectId

  /** SHA-256 của bản đã ký. */
  @Column({ nullable: true })
  sha256?: string | null

  // --- Chung ---

  @Column({ nullable: true })
  byteLength?: number | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}

/** Bản ghi canonical với các trường bắt buộc của hình `ContractArtifact` cũ. */
export type CanonicalContractDocument = ContractDocument &
  Pick<
    ContractArtifact,
    | 'templateRef'
    | 'legalProfile'
    | 'gridFsFileId'
    | 'artifactHash'
    | 'byteLength'
    | 'contentType'
  > & { kind: 'canonical' }

/** Bản ghi signed với các trường bắt buộc của hình `ContractSignedArtifact` cũ. */
export type SignedContractDocument = ContractDocument &
  Pick<
    ContractSignedArtifact,
    | 'signerId'
    | 'signerRole'
    | 'canonicalHash'
    | 'status'
    | 'preparedFileId'
    | 'contentDigest'
    | 'signedAttrsDigest'
    | 'signingTime'
    | 'signerPem'
    | 'chainPem'
  > & { kind: 'signed' }
