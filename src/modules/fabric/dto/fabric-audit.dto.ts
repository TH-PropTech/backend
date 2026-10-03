import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsDateString,
  IsIn,
  IsMongoId,
  IsOptional,
  Matches,
  MaxLength,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'
import {
  AUDIT_DELIVERY_STATES,
  AUDIT_EVENT_TYPES,
  AUDIT_VERIFICATION_STATES,
  type AuditDeliveryState,
  type AuditExplorerAction,
  type AuditVerificationState,
} from '../ledger-audit-center.types'

/** Mã lỗi ổn định của Audit Center (D9). */
export const AUDIT_ERROR_CODES = [
  'AUDIT_FILTER_INVALID',
  'AUDIT_EVENT_NOT_FOUND',
] as const

export class AuditEventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo định danh hợp đồng' })
  @IsOptional()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  contractId?: string

  @ApiPropertyOptional({ enum: AUDIT_EVENT_TYPES })
  @IsOptional()
  @IsIn([...AUDIT_EVENT_TYPES])
  eventType?: string

  @ApiPropertyOptional({ enum: AUDIT_DELIVERY_STATES })
  @IsOptional()
  @IsIn([...AUDIT_DELIVERY_STATES])
  state?: AuditDeliveryState

  @ApiPropertyOptional({
    enum: AUDIT_VERIFICATION_STATES,
    description:
      'Trạng thái xác minh theo dữ liệu cục bộ: verified = commit Fabric thật có txId; unavailable = mô phỏng; not-recorded = chưa commit; mismatch = có phát hiện đối soát hash/schema đang mở',
  })
  @IsOptional()
  @IsIn([...AUDIT_VERIFICATION_STATES])
  verificationState?: AuditVerificationState

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  from?: string

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string

  @ApiPropertyOptional({ description: 'Mã giao dịch Fabric' })
  @IsOptional()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_.:-]+$/)
  txId?: string
}

export class AuditEventIdParamDto {
  @ApiProperty({ description: 'ID sự kiện sổ cái (ObjectId hex)' })
  @IsMongoId()
  id!: string
}

class AuditRuntimeDto {
  @ApiProperty({ enum: ['simulation', 'fabric'] })
  mode!: 'simulation' | 'fabric'
  @ApiProperty({
    enum: ['simulation', 'live', 'degraded', 'unavailable'],
    description:
      'simulation: chế độ mô phỏng (không có bằng chứng Fabric); live: kết nối và sẵn sàng; degraded: kết nối nhưng không sẵn sàng; unavailable: mất kết nối',
  })
  state!: 'simulation' | 'live' | 'degraded' | 'unavailable'
  @ApiProperty() ready!: boolean
  @ApiProperty({ enum: ['disabled', 'connected', 'unavailable'] })
  connectionState!: 'disabled' | 'connected' | 'unavailable'
  @ApiProperty({ nullable: true, type: Number }) abiVersion!: number | null
  @ApiProperty({ type: [Number] }) evidenceSchemaVersions!: number[]
  @ApiProperty({ type: [String] }) errorCodes!: string[]
}

class AuditOutboxDto {
  @ApiProperty() pending!: number
  @ApiProperty() processing!: number
  @ApiProperty() retryable!: number
  @ApiProperty() succeeded!: number
  @ApiProperty() terminalFailure!: number
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  oldestPendingAt!: string | null
  @ApiProperty({ nullable: true, type: Number })
  oldestPendingAgeSeconds!: number | null
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  oldestTerminalFailureAt!: string | null
  @ApiProperty({ nullable: true, type: Number })
  oldestTerminalFailureAgeSeconds!: number | null
}

export class AuditWorkerDto {
  @ApiProperty({ enum: ['ready', 'degraded'] })
  state!: 'ready' | 'degraded'
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  oldestPendingAt!: string | null
}

class AuditLedgerDto {
  @ApiProperty({ nullable: true, type: Number }) height!: number | null
  @ApiProperty({ nullable: true, type: String })
  currentBlockHash!: string | null
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  observedAt!: string | null
}

class AuditIdentityWarningDto {
  @ApiProperty({ enum: ['writer', 'reader', 'operator'] })
  role!: 'writer' | 'reader' | 'operator'
  @ApiProperty({ enum: ['expiring', 'expired'] })
  state!: 'expiring' | 'expired'
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  expiresAt!: string | null
}

class AuditOverviewExplorerDto {
  @ApiProperty() enabled!: boolean
  @ApiProperty({ enum: ['disabled', 'ready', 'degraded'] })
  state!: 'disabled' | 'ready' | 'degraded'
  @ApiProperty() available!: boolean
  @ApiProperty({
    nullable: true,
    enum: ['EXPLORER_NOT_CONFIGURED', 'EXPLORER_DEGRADED'],
  })
  reason!: AuditExplorerAction['reason']
}

class AuditCoverageDto {
  @ApiProperty() eventType!: string
  @ApiProperty() total!: number
  @ApiProperty() pending!: number
  @ApiProperty() confirmed!: number
  @ApiProperty() failed!: number
}

class AuditRunCountersDto {
  @ApiProperty() examined!: number
  @ApiProperty() consistent!: number
  @ApiProperty() findings!: number
  @ApiProperty() unverifiable!: number
}

class AuditLatestRunDto {
  @ApiProperty() id!: string
  @ApiProperty() status!: string
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  startedAt!: string | null
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  completedAt!: string | null
  @ApiProperty({ type: AuditRunCountersDto })
  counters!: AuditRunCountersDto
}

class AuditReconciliationSummaryDto {
  @ApiProperty({ nullable: true, type: AuditLatestRunDto })
  latestRun!: AuditLatestRunDto | null
  @ApiProperty() openFindings!: number
}

export class AuditOverviewResponseDto {
  @ApiProperty({ format: 'date-time' }) generatedAt!: string
  @ApiProperty({ type: AuditRuntimeDto }) runtime!: AuditRuntimeDto
  @ApiProperty({ type: AuditOutboxDto }) outbox!: AuditOutboxDto
  @ApiProperty({ type: AuditWorkerDto }) worker!: AuditWorkerDto
  @ApiProperty({ type: AuditLedgerDto }) ledger!: AuditLedgerDto
  @ApiProperty({ type: [AuditIdentityWarningDto] })
  identityWarnings!: AuditIdentityWarningDto[]
  @ApiProperty({ type: AuditOverviewExplorerDto })
  explorer!: AuditOverviewExplorerDto
  @ApiProperty({ type: [AuditCoverageDto] }) coverage!: AuditCoverageDto[]
  @ApiProperty({ type: AuditReconciliationSummaryDto })
  reconciliation!: AuditReconciliationSummaryDto
}

export class AuditEventSummaryResponseDto {
  @ApiProperty() id!: string
  @ApiProperty() eventType!: string
  @ApiProperty() aggregateType!: string
  @ApiProperty({ description: '6 ký tự cuối của định danh aggregate' })
  aggregateRef!: string
  @ApiProperty({ nullable: true, type: String }) contractId!: string | null
  @ApiProperty({ enum: AUDIT_DELIVERY_STATES }) status!: AuditDeliveryState
  @ApiProperty({ enum: AUDIT_VERIFICATION_STATES })
  verificationState!: AuditVerificationState
  @ApiProperty({ enum: ['fabric', 'simulation'] })
  networkMode!: 'fabric' | 'simulation'
  @ApiProperty({ nullable: true, type: String }) txId!: string | null
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Chỉ có cho Fabric thật; luôn null ở mô phỏng',
  })
  blockNumber!: number | null
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Dựng từ template cấu hình, không bao giờ từ host của request',
  })
  explorerUrl!: string | null
  @ApiProperty() payloadHash!: string
  @ApiProperty() attempts!: number
  @ApiProperty({ nullable: true, type: String }) failureCode!: string | null
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  recordedAt!: string | null
}

class AuditDependencyDto {
  @ApiProperty() key!: string
  @ApiProperty({
    enum: ['confirmed', 'pending', 'processing', 'failed', 'missing'],
  })
  state!: 'confirmed' | 'pending' | 'processing' | 'failed' | 'missing'
}

class AuditExplorerActionDto {
  @ApiProperty() available!: boolean
  @ApiProperty({ nullable: true, type: String }) url!: string | null
  @ApiProperty({
    nullable: true,
    enum: [
      'EXPLORER_NOT_CONFIGURED',
      'EXPLORER_DEGRADED',
      'NOT_COMMITTED_ON_FABRIC',
    ],
  })
  reason!: AuditExplorerAction['reason']
}

class AuditVerificationDto {
  @ApiProperty({ enum: AUDIT_VERIFICATION_STATES })
  status!: AuditVerificationState
  @ApiProperty({ nullable: true, type: String }) reason!: string | null
}

export class AuditEventDetailResponseDto extends AuditEventSummaryResponseDto {
  @ApiProperty({ type: [AuditDependencyDto] })
  dependencies!: AuditDependencyDto[]
  @ApiProperty({ type: AuditExplorerActionDto })
  explorer!: AuditExplorerActionDto
  @ApiProperty({ type: AuditVerificationDto })
  verification!: AuditVerificationDto
}

export class AuditEventsPageResponseDto {
  @ApiProperty({ type: [AuditEventSummaryResponseDto] })
  items!: AuditEventSummaryResponseDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() limit!: number
  @ApiProperty() totalPages!: number
}
