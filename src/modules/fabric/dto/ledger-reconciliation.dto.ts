import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'
import { RECONCILIATION_EVENT_TYPES } from '../ledger-reconciliation.sources'
import type {
  LedgerReconciliationFinding,
  LedgerReconciliationFindingCategory,
  LedgerReconciliationFindingStatus,
} from '../schemas/ledger-reconciliation-finding.schema'
import type { LedgerReconciliationRun } from '../schemas/ledger-reconciliation-run.schema'

export const RECONCILIATION_FINDING_CATEGORIES = [
  'missing_delivery_work',
  'retryable_delivery_failure',
  'terminal_delivery_failure',
  'missing_local_projection',
  'missing_ledger_evidence',
  'hash_schema_mismatch',
  'orphan_local_projection',
  'orphan_ledger_evidence',
  'unverifiable',
] as const

export const RECONCILIATION_FINDING_STATUSES = [
  'open',
  'repair-pending',
  'resolved',
  'accepted-risk',
] as const

/** Mã lỗi ổn định của đối soát (D9). */
export const RECONCILIATION_ERROR_CODES = [
  'RECONCILIATION_SCOPE_REQUIRED',
  'RECONCILIATION_SCOPE_INVALID',
  'RECONCILIATION_SCOPE_LOCKED',
  'RECONCILIATION_RUN_NOT_FOUND',
  'RECONCILIATION_RUN_NOT_RESUMABLE',
  'RECONCILIATION_RUN_NOT_CANCELLABLE',
  'RECONCILIATION_FINDING_NOT_FOUND',
  'RECONCILIATION_REASON_REQUIRED',
  'LEDGER_FINDING_NOT_REPAIRABLE',
  'LEDGER_FINDING_PRECONDITION_STALE',
] as const

export class StartReconciliationRunDto {
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Cần cả from và to, tối đa 92 ngày',
  })
  @IsOptional()
  @IsDateString()
  from?: string

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string

  @ApiPropertyOptional({
    type: [String],
    description:
      'Phạm vi hợp đồng cụ thể (ObjectId); thay thế cho khoảng thời gian',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsMongoId({ each: true })
  contractIds?: string[]

  @ApiPropertyOptional({
    enum: RECONCILIATION_EVENT_TYPES,
    isArray: true,
    description:
      'Nêu rõ event types để bật phát hiện orphan trên ledger (có ngân sách trang)',
  })
  @IsOptional()
  @IsArray()
  @IsIn([...RECONCILIATION_EVENT_TYPES], { each: true })
  eventTypes?: string[]
}

export class ReconciliationRunListQueryDto extends PaginationQueryDto {}

export class ReconciliationFindingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RECONCILIATION_FINDING_CATEGORIES })
  @IsOptional()
  @IsIn([...RECONCILIATION_FINDING_CATEGORIES])
  category?: LedgerReconciliationFindingCategory

  @ApiPropertyOptional({ enum: RECONCILIATION_FINDING_STATUSES })
  @IsOptional()
  @IsIn([...RECONCILIATION_FINDING_STATUSES])
  status?: LedgerReconciliationFindingStatus
}

export class ReconciliationRunIdParamDto {
  @ApiProperty({ description: 'ID lần đối soát (ObjectId hex)' })
  @IsMongoId()
  id!: string
}

export class ReconciliationFindingIdParamDto {
  @ApiProperty({ description: 'ID phát hiện đối soát (ObjectId hex)' })
  @IsMongoId()
  id!: string
}

export class RepairFindingDto {
  @ApiProperty({
    minLength: 5,
    maxLength: 500,
    description: 'Lý do bắt buộc, được ghi vào nhật ký',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string
}

class ReconciliationScopeDto {
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  from!: string | null
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  to!: string | null
  @ApiProperty({
    description: 'Số hợp đồng trong phạm vi (không liệt kê định danh)',
  })
  contractCount!: number
  @ApiProperty({ nullable: true, type: [String] })
  eventTypes!: string[] | null
}

class ReconciliationCountersDto {
  @ApiProperty() examined!: number
  @ApiProperty() consistent!: number
  @ApiProperty() findings!: number
  @ApiProperty() unverifiable!: number
}

export class ReconciliationRunResponseDto {
  @ApiProperty() id!: string
  @ApiProperty({ type: ReconciliationScopeDto }) scope!: ReconciliationScopeDto
  @ApiProperty({
    enum: [
      'queued',
      'running',
      'completed',
      'completed-with-findings',
      'failed',
      'cancelled',
    ],
  })
  status!: string
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Pha đang xử lý; vị trí/bookmark nội bộ không được lộ',
  })
  checkpointPhase!: string | null
  @ApiProperty({ type: ReconciliationCountersDto })
  counters!: ReconciliationCountersDto
  @ApiProperty() requestedBy!: string
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  startedAt!: string | null
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  completedAt!: string | null
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'FABRIC_UNAVAILABLE | FABRIC_SIMULATION_MODE | ORPHAN_SCAN_BUDGET_EXHAUSTED | RECONCILIATION_RUN_FAILED',
  })
  lastErrorCode!: string | null
  @ApiProperty({ format: 'date-time' }) createdAt!: string

  static fromEntity(
    run: LedgerReconciliationRun
  ): ReconciliationRunResponseDto {
    return {
      id: run._id.toHexString(),
      scope: {
        from: run.scope.from ? new Date(run.scope.from).toISOString() : null,
        to: run.scope.to ? new Date(run.scope.to).toISOString() : null,
        contractCount: run.scope.contractIds?.length ?? 0,
        eventTypes: run.scope.eventTypes ?? null,
      },
      status: run.status,
      checkpointPhase: run.checkpoint?.eventType ?? null,
      counters: { ...run.counters },
      requestedBy: run.requestedBy,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      lastErrorCode: run.lastErrorCode ?? null,
      createdAt: run.createdAt.toISOString(),
    }
  }
}

class FindingAuditDto {
  @ApiProperty() actorId!: string
  @ApiProperty() reason!: string
}

class FindingRepairDto extends FindingAuditDto {
  @ApiProperty({ format: 'date-time' }) requestedAt!: string
}

class FindingResolutionDto extends FindingAuditDto {
  @ApiProperty({ format: 'date-time' }) resolvedAt!: string
}

const REPAIRABLE_MISSING_EVENTS = [
  'governance.published',
  'move-in.settled',
  'handover.completed',
]

export class ReconciliationFindingResponseDto {
  @ApiProperty() id!: string
  @ApiProperty() runId!: string
  @ApiProperty({ enum: RECONCILIATION_FINDING_CATEGORIES })
  category!: LedgerReconciliationFindingCategory
  @ApiProperty({ enum: RECONCILIATION_FINDING_STATUSES })
  status!: LedgerReconciliationFindingStatus
  @ApiProperty({ nullable: true, type: String }) contractId!: string | null
  @ApiProperty() aggregateType!: string
  @ApiProperty() aggregateId!: string
  @ApiProperty() eventType!: string
  @ApiProperty({ nullable: true, type: String }) expectedHash!: string | null
  @ApiProperty({ nullable: true, type: String }) observedHash!: string | null
  @ApiProperty({
    description:
      'true khi có hành động sửa tự động an toàn (tạo lại outbox / retry terminal); sai lệch hash không bao giờ có sửa tự động',
  })
  repairable!: boolean
  @ApiProperty({ nullable: true, type: String }) recoveryOutboxId!:
    | string
    | null
  @ApiProperty({ nullable: true, type: FindingRepairDto })
  repair!: FindingRepairDto | null
  @ApiProperty({ nullable: true, type: FindingResolutionDto })
  resolution!: FindingResolutionDto | null
  @ApiProperty({ format: 'date-time' }) firstSeenAt!: string
  @ApiProperty({ format: 'date-time' }) lastSeenAt!: string

  static fromEntity(
    finding: LedgerReconciliationFinding
  ): ReconciliationFindingResponseDto {
    const repairable =
      finding.status === 'open' &&
      (finding.category === 'terminal_delivery_failure' ||
        (finding.category === 'missing_delivery_work' &&
          REPAIRABLE_MISSING_EVENTS.includes(finding.eventType)))
    return {
      id: finding._id.toHexString(),
      runId: finding.runId,
      category: finding.category,
      status: finding.status,
      contractId: finding.contractId ?? null,
      aggregateType: finding.aggregateType,
      aggregateId: finding.aggregateId,
      eventType: finding.eventType,
      expectedHash: finding.expectedHash ?? null,
      observedHash: finding.observedHash ?? null,
      repairable,
      recoveryOutboxId: finding.recoveryOutboxId ?? null,
      repair: finding.repair
        ? {
            actorId: finding.repair.actorId,
            reason: finding.repair.reason,
            requestedAt: new Date(finding.repair.requestedAt).toISOString(),
          }
        : null,
      resolution: finding.resolution
        ? {
            actorId: finding.resolution.actorId,
            reason: finding.resolution.reason,
            resolvedAt: new Date(finding.resolution.resolvedAt).toISOString(),
          }
        : null,
      firstSeenAt: finding.firstSeenAt.toISOString(),
      lastSeenAt: finding.lastSeenAt.toISOString(),
    }
  }
}

export class ReconciliationRunsPageResponseDto {
  @ApiProperty({ type: [ReconciliationRunResponseDto] })
  items!: ReconciliationRunResponseDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() limit!: number
  @ApiProperty() totalPages!: number
}

export class ReconciliationFindingsPageResponseDto {
  @ApiProperty({ type: [ReconciliationFindingResponseDto] })
  items!: ReconciliationFindingResponseDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() limit!: number
  @ApiProperty() totalPages!: number
}

export class RepairFindingResponseDto {
  @ApiProperty({ type: ReconciliationFindingResponseDto })
  finding!: ReconciliationFindingResponseDto
  @ApiProperty({
    description: 'ID outbox item được tạo/retry và liên kết với phát hiện',
  })
  outboxId!: string
  @ApiProperty({
    description: 'true khi phát hiện đã được sửa trước đó (idempotent)',
  })
  alreadyRepaired!: boolean
}
