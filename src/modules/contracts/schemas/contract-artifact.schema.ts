import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
} from 'typeorm'

@Entity('contract_artifacts')
@Index(['contractId', 'revision'])
@Index(['contractId', 'revision', 'amendmentId'], { unique: true })
export class ContractArtifact {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  contractId!: string

  @Column()
  revision!: number

  @Column('json')
  templateRef!: {
    key: string
    version: number
    contentHash: string
  }

  @Column()
  legalProfile!: string

  @Column('objectId')
  gridFsFileId!: ObjectId

  @Column()
  artifactHash!: string

  @Column({ nullable: true })
  canonicalContentHash?: string | null

  @Column({ nullable: true })
  rendererVersion?: string | null

  @Column({ nullable: true })
  sourceSchemaVersion?: number | null

  @Column({ nullable: true })
  amendmentId?: string | null

  @Column()
  byteLength!: number

  @Column()
  contentType!: 'application/pdf'

  @Column({ nullable: true })
  lockedAt?: Date | null

  @CreateDateColumn()
  createdAt!: Date
}
