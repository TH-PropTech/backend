import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsMongoId } from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'
import type {
  FabricGovernanceLedgerStatus,
  FabricGovernanceSnapshot,
  FabricGovernanceSnapshotComponents,
} from '../schemas/fabric-governance-snapshot.schema'
import type {
  GovernanceVerification,
  GovernanceVerificationStatus,
} from '../fabric-governance.service'

/** Mã lỗi ổn định của nhóm governance (D9). */
export const GOVERNANCE_ERROR_CODES = [
  'GOVERNANCE_SNAPSHOT_INCOMPLETE',
  'GOVERNANCE_SECRET_CLASSIFIED',
  'GOVERNANCE_SNAPSHOT_NOT_FOUND',
  'GOVERNANCE_SNAPSHOT_CONFLICT',
] as const

export class GovernanceSnapshotListQueryDto extends PaginationQueryDto {}

export class GovernanceSnapshotIdParamDto {
  @ApiProperty({ description: 'ID governance snapshot (ObjectId hex)' })
  @IsMongoId()
  id!: string
}

class GovernanceComponentRefDto {
  @ApiProperty() id!: string
  @ApiProperty() version!: number
  @ApiProperty({ description: 'SHA-256 hex của nguồn' }) hash!: string
}

class GovernanceExecutionPolicyRefDto {
  @ApiProperty() policyId!: string
  @ApiProperty() version!: number
  @ApiProperty({ description: 'SHA-256 hex của nguồn' }) hash!: string
}

class GovernancePolicyRefDto {
  @ApiProperty() key!: string
  @ApiProperty() value!: string
  @ApiProperty({ nullable: true, type: String }) unit!: string | null
  @ApiProperty({ description: 'SHA-256 hex của {key, value, unit}' })
  hash!: string
}

export class GovernanceSnapshotComponentsDto {
  @ApiProperty({ type: [GovernanceComponentRefDto] })
  legalTerms!: GovernanceComponentRefDto[]

  @ApiProperty({ type: [GovernancePolicyRefDto] })
  policySet!: GovernancePolicyRefDto[]

  @ApiProperty({ type: [GovernanceComponentRefDto] })
  contractTemplate!: GovernanceComponentRefDto[]

  @ApiProperty({
    type: [GovernanceComponentRefDto],
    nullable: true,
  })
  contractLayout!: GovernanceComponentRefDto[] | null

  @ApiProperty({ type: [GovernanceExecutionPolicyRefDto] })
  rentalExecutionPolicy!: GovernanceExecutionPolicyRefDto[]

  @ApiProperty({ type: GovernanceComponentRefDto, nullable: true })
  feeSchedule!: GovernanceComponentRefDto | null
}

/**
 * Bản chiếu đã khử nhạy cảm của snapshot: chỉ định danh + hash của nguồn,
 * không có nội dung nguồn, `_id` thô hay timestamp nội bộ.
 */
export class GovernanceSnapshotResponseDto {
  @ApiProperty({ description: 'ID snapshot (ObjectId hex)' }) id!: string
  @ApiProperty({ example: 'GOV-000001' }) snapshotCode!: string
  @ApiProperty() version!: number
  @ApiProperty() manifestSchemaVersion!: number
  @ApiProperty({ enum: ['published'] }) status!: 'published'
  @ApiProperty({ type: GovernanceSnapshotComponentsDto })
  components!: FabricGovernanceSnapshotComponents
  @ApiProperty({ description: 'SHA-256 hex của manifest chuẩn hoá' })
  manifestHash!: string
  @ApiProperty({
    enum: [
      'pending',
      'confirmed-fabric',
      'confirmed-simulation',
      'failed-terminal',
    ],
  })
  ledgerStatus!: FabricGovernanceLedgerStatus
  @ApiProperty({ nullable: true, type: String }) txHash!: string | null
  @ApiProperty({ nullable: true, type: Number }) blockNumber!: number | null
  @ApiProperty() publishedBy!: string
  @ApiProperty({ format: 'date-time' }) publishedAt!: string

  static fromEntity(
    snapshot: FabricGovernanceSnapshot
  ): GovernanceSnapshotResponseDto {
    return {
      id: snapshot._id.toHexString(),
      snapshotCode: snapshot.snapshotCode,
      version: snapshot.version,
      manifestSchemaVersion: snapshot.manifestSchemaVersion,
      status: snapshot.status,
      components: snapshot.components,
      manifestHash: snapshot.manifestHash,
      ledgerStatus: snapshot.ledgerStatus,
      txHash: snapshot.txHash ?? null,
      blockNumber: snapshot.blockNumber ?? null,
      publishedBy: snapshot.publishedBy,
      publishedAt: snapshot.publishedAt.toISOString(),
    }
  }
}

export class PublishGovernanceSnapshotResponseDto {
  @ApiProperty({
    description:
      'true khi tạo version mới; false khi manifest trùng bản mới nhất (idempotent, không tạo version)',
  })
  created!: boolean
  @ApiProperty({ type: GovernanceSnapshotResponseDto })
  snapshot!: GovernanceSnapshotResponseDto
}

export class GovernanceSnapshotPageResponseDto {
  @ApiProperty({ type: [GovernanceSnapshotResponseDto] })
  items!: GovernanceSnapshotResponseDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() limit!: number
  @ApiProperty() totalPages!: number
}

export class GovernanceVerificationResponseDto {
  @ApiProperty() snapshotId!: string
  @ApiProperty() version!: number
  @ApiProperty({
    enum: ['verified', 'mismatch', 'unavailable', 'not-recorded'],
    description:
      'verified: ledger khớp; mismatch: khác hash/version/schema; unavailable: không truy vấn được Fabric (hoặc simulation); not-recorded: ledger chưa có snapshot',
  })
  status!: GovernanceVerificationStatus
  @ApiProperty({ description: 'manifestHash lưu trong MongoDB' })
  localManifestHash!: string
  @ApiProperty({ nullable: true, type: String })
  ledgerManifestHash!: string | null
  @ApiProperty({ type: [String] }) mismatchFields!: string[]
  @ApiPropertyOptional({ nullable: true, type: String }) txHash!: string | null
  @ApiPropertyOptional({ nullable: true, type: Number })
  blockNumber!: number | null
  @ApiProperty({ enum: ['fabric', 'simulation'] })
  networkMode!: 'fabric' | 'simulation'
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Mã lý do ổn định khi unavailable: FABRIC_UNAVAILABLE | FABRIC_QUERY_FAILED | FABRIC_SIMULATION_MODE',
  })
  reason!: string | null
  @ApiProperty({ format: 'date-time' }) checkedAt!: string

  static fromResult(
    result: GovernanceVerification
  ): GovernanceVerificationResponseDto {
    return { ...result }
  }
}
