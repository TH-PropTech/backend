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
 * Bản PDF đã ký PAdES: artifact riêng, song song với canonical artifact.
 * Không bao giờ sửa `Contract.artifactRef` hay `contentLockedHash`.
 *
 * @deprecated G-DOC: dữ liệu nay nằm ở `ContractDocument{kind:'signed'}`
 * (collection `contract_documents`). Giữ lại làm kiểu hình cũ và để migration
 * 011 / rollback tham chiếu collection cũ `contract_signed_artifacts`; entity
 * này KHÔNG còn nằm trong `TypeOrmModule.forFeature`.
 */
@Entity('contract_signed_artifacts')
@Index(['contractId', 'revision'])
export class ContractSignedArtifact {
  @ObjectIdColumn() _id!: ObjectId
  @Column() contractId!: string
  @Column() signerId!: string
  @Column() signerRole!: 'tenant' | 'landlord'
  /** Hash của canonical artifact mà bản đã ký này dựa trên. */
  @Column() canonicalHash!: string
  /** Số thứ tự bản đã ký của contract (bên ký sau tạo revision kế tiếp). */
  @Column() revision!: number
  @Column({ type: 'string', default: 'prepared' })
  status!: 'prepared' | 'ready' | 'failed'
  @Column({ nullable: true }) errorCode?: string | null
  @Column({ nullable: true }) sessionId?: string | null
  /** PDF đã có placeholder và /ByteRange, đợi chữ ký. */
  @Column('objectId') preparedFileId!: ObjectId
  @Column() contentDigest!: string
  @Column() signedAttrsDigest!: string
  @Column() signingTime!: Date
  /** Chứng thư công khai của người ký (không phải secret), cần để dựng CMS. */
  @Column() signerPem!: string
  @Column('array') chainPem!: string[]
  @Column('objectId')
  signedFileId?: ObjectId
  /** SHA-256 của bản đã ký. */
  @Column({ nullable: true }) sha256?: string | null
  @Column({ nullable: true }) byteLength?: number | null
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
