import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

export type FabricGovernanceSnapshotStatus = 'published'
export type FabricGovernanceLedgerStatus =
  | 'pending'
  | 'confirmed-fabric'
  | 'confirmed-simulation'
  | 'failed-terminal'

export type FabricGovernanceSnapshotComponents = {
  legalTerms: Array<{ id: string; version: number; hash: string }>
  policySet: Array<{
    key: string
    value: string
    unit: string | null
    hash: string
  }>
  /** PROP-399 D2 decision (2026-10-02): mảng — mỗi legal profile có một template đã publish (VN_INDIVIDUAL_RESIDENTIAL_LEASE, VN_RE_BUSINESS_ND96_APPENDIX_II). */
  contractTemplate: Array<{ id: string; version: number; hash: string }>
  /** Mảng các layout profile đã publish, hoặc null khi chưa có layout nào. */
  contractLayout: Array<{ id: string; version: number; hash: string }> | null
  /** PROP-399 D2 decision (2026-10-02): array, not a singleton — multiple policyIds can be published at once. */
  rentalExecutionPolicy: Array<{
    policyId: string
    version: number
    hash: string
  }>
  feeSchedule: { id: string; version: number; hash: string } | null
}

/**
 * PROP-399 D2: manifest bất biến của một snapshot cấu hình/pháp lý đã publish.
 * Chỉ lưu định danh + hash của từng nguồn — không lưu nội dung nguồn, bí mật hay PII.
 */
@Entity('fabric_governance_snapshots')
@Index(['version'], { unique: true })
@Index(['snapshotCode'], { unique: true })
@Index(['ledgerStatus', 'publishedAt'])
export class FabricGovernanceSnapshot {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  snapshotCode!: string

  @Column()
  version!: number

  @Column({ default: 1 })
  manifestSchemaVersion!: 1

  @Column({ type: 'string' })
  status!: FabricGovernanceSnapshotStatus

  @Column('json')
  components!: FabricGovernanceSnapshotComponents

  @Column()
  manifestHash!: string

  @Column({ type: 'string', default: 'pending' })
  ledgerStatus!: FabricGovernanceLedgerStatus

  @Column({ nullable: true })
  txHash!: string | null

  @Column({ nullable: true, type: 'int' })
  blockNumber!: number | null

  @Column()
  publishedBy!: string

  @Column()
  publishedAt!: Date

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
