import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
} from 'typeorm'

@Entity('contract_artifacts')
@Index(['contractId', 'revision'], { unique: true })
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

  @Column()
  byteLength!: number

  @Column()
  contentType!: 'application/pdf'

  @Column({ nullable: true })
  lockedAt?: Date | null

  @CreateDateColumn()
  createdAt!: Date
}
