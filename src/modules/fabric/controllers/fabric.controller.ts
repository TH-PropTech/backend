import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  BadRequestException,
  HttpCode,
  Res,
} from '@nestjs/common'
import {
  ApiProperty,
  ApiPropertyOptional,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import type { Response } from 'express'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { IsString, IsArray, IsOptional } from 'class-validator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  FabricService,
  type FabricIdentityCheck,
} from '../services/fabric.service'
import { BlockchainLog } from '../schemas/blockchain-log.schema'
import { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import { KindScopedActivityLogRepository } from '../../activity-log/utils/kind-scoped-activity-log.repository'
import { toBlockchainLog } from '../../activity-log/utils/legacy-log.mapper'
import { LedgerOutboxService } from '../services/ledger-outbox.service'
import { LedgerOutbox } from '../schemas/ledger-outbox.schema'
import { FabricGovernanceService } from '../services/fabric-governance.service'
import {
  GovernanceSnapshotIdParamDto,
  GovernanceSnapshotListQueryDto,
  GovernanceSnapshotPageResponseDto,
  GovernanceSnapshotResponseDto,
  GovernanceVerificationResponseDto,
  PublishGovernanceSnapshotResponseDto,
} from '../dto/fabric-governance.dto'
import {
  AuditEventDetailResponseDto,
  AuditEventIdParamDto,
  AuditEventsPageResponseDto,
  AuditEventsQueryDto,
  AuditOverviewResponseDto,
  AuditWorkerDto,
} from '../dto/fabric-audit.dto'
import { LedgerAuditQueryService } from '../services/ledger-audit-query.service'
import { LedgerReconciliationService } from '../services/ledger-reconciliation.service'
import {
  ReconciliationFindingIdParamDto,
  ReconciliationFindingResponseDto,
  ReconciliationFindingsPageResponseDto,
  ReconciliationFindingsQueryDto,
  ReconciliationRunIdParamDto,
  ReconciliationRunListQueryDto,
  ReconciliationRunResponseDto,
  ReconciliationRunsPageResponseDto,
  RepairFindingDto,
  RepairFindingResponseDto,
  StartReconciliationRunDto,
} from '../dto/ledger-reconciliation.dto'

// ── DTOs ──

export class SubmitTxDto {
  @IsString()
  action!: string

  @IsArray()
  @IsString({ each: true })
  args!: string[]

  @IsOptional()
  @IsString()
  contractId?: string

  @IsOptional()
  @IsString()
  paymentId?: string
}

export class QueryTxDto {
  @IsString()
  action!: string

  @IsArray()
  @IsString({ each: true })
  args!: string[]
}

export class FabricIdentityCheckDto {
  @ApiProperty({
    enum: [
      'ok',
      'expiring',
      'expired',
      'invalid',
      'missing',
      'disabled',
      'unavailable',
    ],
  })
  state!: FabricIdentityCheck['state']
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  expiresAt!: string | null
  @ApiProperty() expiringSoon!: boolean
  @ApiProperty({ nullable: true, type: String })
  errorCode!: string | null
}

export class FabricIdentitiesDto {
  @ApiProperty({ type: FabricIdentityCheckDto }) writer!: FabricIdentityCheckDto
  @ApiProperty({ type: FabricIdentityCheckDto }) reader!: FabricIdentityCheckDto
  @ApiProperty({ type: FabricIdentityCheckDto })
  operator!: FabricIdentityCheckDto
}

export class FabricGatewayStatusDto {
  @ApiProperty({ enum: ['disabled', 'connected', 'unavailable'] })
  state!: 'disabled' | 'connected' | 'unavailable'
  @ApiProperty({ nullable: true, type: Number }) abiVersion!: number | null
}

export class FabricLedgerStatusDto {
  @ApiProperty({ nullable: true, type: Number }) height!: number | null
  @ApiProperty({ nullable: true, type: String })
  currentBlockHash!: string | null
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  observedAt!: string | null
}

export class FabricExplorerStatusDto {
  @ApiProperty() enabled!: boolean
  @ApiProperty({ enum: ['disabled', 'ready', 'degraded'] })
  state!: 'disabled' | 'ready' | 'degraded'
  @ApiProperty({ nullable: true, type: String }) publicUrl!: string | null
}

/**
 * Trạng thái Fabric. Các trường gốc giữ nguyên nghĩa; PROP-399 D5 chỉ BỔ SUNG
 * (chaincodeAbiVersion, evidenceSchemaVersions, gateway, identities, ledger, explorer, errorCodes).
 */
export class FabricStatusResponseDto {
  @ApiProperty({ enum: ['simulation', 'fabric'] })
  mode!: 'simulation' | 'fabric'
  @ApiProperty({ enum: ['disabled', 'connected', 'unavailable'] })
  connectionState!: 'disabled' | 'connected' | 'unavailable'
  @ApiProperty() ready!: boolean
  @ApiPropertyOptional() channel?: string | undefined
  @ApiPropertyOptional() chaincode?: string | undefined
  @ApiPropertyOptional({ enum: [1, 2] }) chaincodeAbiVersion?: 1 | 2
  @ApiProperty({ format: 'date-time' }) lastCheckedAt!: string
  @ApiPropertyOptional({ nullable: true, type: String })
  errorCode?: string | null
  @ApiPropertyOptional({ type: [Number] }) evidenceSchemaVersions?: number[]
  @ApiPropertyOptional({ type: FabricGatewayStatusDto })
  gateway?: FabricGatewayStatusDto
  @ApiPropertyOptional({ type: FabricIdentitiesDto })
  identities?: FabricIdentitiesDto
  @ApiPropertyOptional({ type: FabricLedgerStatusDto })
  ledger?: FabricLedgerStatusDto
  @ApiPropertyOptional({ type: FabricExplorerStatusDto })
  explorer?: FabricExplorerStatusDto
  @ApiPropertyOptional({ type: AuditWorkerDto })
  worker?: AuditWorkerDto
  @ApiPropertyOptional({
    type: [String],
    description:
      'Mã ổn định: lỗi chặn readiness (đầu danh sách) rồi cảnh báo như FABRIC_IDENTITY_EXPIRING, FABRIC_EXPLORER_DEGRADED',
  })
  errorCodes?: string[]
}

// ── Controller ──

@ApiTags('fabric')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('fabric')
export class FabricController {
  private readonly logRepository: KindScopedActivityLogRepository<BlockchainLog>

  constructor(
    private readonly fabricService: FabricService,
    private readonly ledgerOutboxService: LedgerOutboxService,
    @InjectRepository(ActivityLog)
    activityLogRepository: Repository<ActivityLog>,
    private readonly governanceService: FabricGovernanceService,
    private readonly auditQueryService: LedgerAuditQueryService,
    private readonly reconciliationService: LedgerReconciliationService
  ) {
    this.logRepository = new KindScopedActivityLogRepository(
      activityLogRepository,
      'blockchain',
      toBlockchainLog
    )
  }

  /** Trạng thái kết nối Hyperledger Fabric — Admin, Nhân viên */
  @Get('status')
  @Roles('admin', 'staff')
  async getStatus(): Promise<FabricStatusResponseDto> {
    const status = this.fabricService.getStatus()
    // worker (PROP-399 D5) là phần bổ sung; lỗi truy vấn outbox không được làm hỏng /fabric/status.
    const worker = await this.auditQueryService
      .getWorkerHealth()
      .catch(() => undefined)
    return worker ? { ...status, worker } : status
  }

  /** Retry terminal failed outbox event — Admin, Nhân viên */
  @Post('outbox/:id/retry')
  @Roles('admin', 'staff')
  async retryOutboxEvent(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<LedgerOutbox> {
    const role = user?.roles?.includes('admin')
      ? 'admin'
      : user?.roles?.includes('staff')
        ? 'staff'
        : 'unknown'
    return this.ledgerOutboxService.retryTerminal(id, role)
  }

  /** Submit transaction lên blockchain — chỉ Admin */
  @Post('submit')
  @Roles('admin')
  async submitTx(@Body() dto: SubmitTxDto): Promise<{
    txHash: string
    blockNumber: number | null
    success: boolean
    networkMode: 'simulation' | 'fabric'
  }> {
    try {
      return await this.fabricService.submitTransaction(dto.action, dto.args, {
        contractId: dto.contractId,
        paymentId: dto.paymentId,
      })
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      throw new BadRequestException(`Giao dịch blockchain thất bại: ${errMsg}`)
    }
  }

  /** Truy vấn dữ liệu từ blockchain (read-only) — Admin, Nhân viên */
  @Post('query')
  @Roles('admin', 'staff')
  async queryTx(@Body() dto: QueryTxDto): Promise<unknown> {
    try {
      return await this.fabricService.evaluateTransaction(dto.action, dto.args)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      throw new BadRequestException(`Truy vấn blockchain thất bại: ${errMsg}`)
    }
  }

  /** Xem lịch sử log giao dịch blockchain — Admin, Nhân viên */
  @Get('logs')
  @Roles('admin', 'staff')
  async getLogs(
    @Query('contractId') contractId?: string,
    @Query('paymentId') paymentId?: string
  ): Promise<BlockchainLog[]> {
    const filter: Record<string, string> = {}
    if (contractId) filter.contractId = contractId
    if (paymentId) filter.paymentId = paymentId

    return this.logRepository.find({
      where: filter,
      order: { createdAt: 'DESC' },
    })
  }

  // ── Governance snapshots (PROP-399 D2/D13) ──

  /** Publish snapshot governance bất biến — chỉ Admin (operator) */
  @Post('governance-snapshots/publish')
  @Roles('admin')
  @ApiOperation({
    summary:
      'Publish governance snapshot (admin). Manifest trùng bản mới nhất trả lại bản đó (200, created=false).',
  })
  @ApiCreatedResponse({ type: PublishGovernanceSnapshotResponseDto })
  @ApiOkResponse({
    type: PublishGovernanceSnapshotResponseDto,
    description: 'Manifest trùng bản mới nhất — idempotent, không tạo version',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'GOVERNANCE_SNAPSHOT_INCOMPLETE | GOVERNANCE_SECRET_CLASSIFIED',
  })
  @ApiForbiddenResponse({ description: 'Chỉ admin được publish' })
  async publishGovernanceSnapshot(
    @CurrentUser('id') actorId: string,
    @Res({ passthrough: true }) response: Response
  ): Promise<PublishGovernanceSnapshotResponseDto> {
    const { snapshot, created } = await this.governanceService.publish({
      id: actorId,
      role: 'admin',
    })
    if (!created) response.status(200)
    return {
      created,
      snapshot: GovernanceSnapshotResponseDto.fromEntity(snapshot),
    }
  }

  /** Danh sách snapshot governance (mới nhất trước) — Admin, Nhân viên */
  @Get('governance-snapshots')
  @Roles('admin', 'staff')
  @ApiOperation({ summary: 'Danh sách governance snapshot (phân trang)' })
  @ApiOkResponse({ type: GovernanceSnapshotPageResponseDto })
  @ApiForbiddenResponse({ description: 'Chỉ admin, staff' })
  async listGovernanceSnapshots(
    @Query() query: GovernanceSnapshotListQueryDto
  ): Promise<GovernanceSnapshotPageResponseDto> {
    const page = await this.governanceService.list({
      page: query.page,
      limit: query.limit,
    })
    return {
      ...page,
      items: page.items.map(item =>
        GovernanceSnapshotResponseDto.fromEntity(item)
      ),
    }
  }

  /** Chi tiết snapshot governance — Admin, Nhân viên */
  @Get('governance-snapshots/:id')
  @Roles('admin', 'staff')
  @ApiOperation({ summary: 'Chi tiết governance snapshot' })
  @ApiOkResponse({ type: GovernanceSnapshotResponseDto })
  @ApiNotFoundResponse({ description: 'GOVERNANCE_SNAPSHOT_NOT_FOUND' })
  async getGovernanceSnapshot(
    @Param() params: GovernanceSnapshotIdParamDto
  ): Promise<GovernanceSnapshotResponseDto> {
    return GovernanceSnapshotResponseDto.fromEntity(
      await this.governanceService.getById(params.id)
    )
  }

  /** Đối chiếu manifestHash cục bộ với Fabric (read-only) — Admin, Nhân viên */
  @Get('governance-snapshots/:id/verify')
  @Roles('admin', 'staff')
  @ApiOperation({
    summary:
      'Xác minh snapshot với Fabric: verified | mismatch | unavailable | not-recorded',
  })
  @ApiOkResponse({ type: GovernanceVerificationResponseDto })
  @ApiNotFoundResponse({ description: 'GOVERNANCE_SNAPSHOT_NOT_FOUND' })
  async verifyGovernanceSnapshot(
    @Param() params: GovernanceSnapshotIdParamDto
  ): Promise<GovernanceVerificationResponseDto> {
    return GovernanceVerificationResponseDto.fromResult(
      await this.governanceService.verify(params.id)
    )
  }

  // ── Audit Center (PROP-399 D6/D9/D13) — đọc: admin + staff ──

  /** Tổng quan runtime, outbox, độ phủ bằng chứng và đối soát — Admin, Nhân viên */
  @Get('audit/overview')
  @Roles('admin', 'staff')
  @ApiOperation({
    summary:
      'Tổng quan Audit Center: runtime (live/simulation/degraded/unavailable), outbox, ledger, identity, coverage',
  })
  @ApiOkResponse({ type: AuditOverviewResponseDto })
  @ApiForbiddenResponse({ description: 'Chỉ admin, staff' })
  getAuditOverview(): Promise<AuditOverviewResponseDto> {
    return this.auditQueryService.getOverview()
  }

  /** Danh sách sự kiện bằng chứng (lọc phía server, phân trang) — Admin, Nhân viên */
  @Get('audit/events')
  @Roles('admin', 'staff')
  @ApiOperation({ summary: 'Danh sách sự kiện bằng chứng, lọc phía server' })
  @ApiOkResponse({ type: AuditEventsPageResponseDto })
  @ApiBadRequestResponse({ description: 'AUDIT_FILTER_INVALID' })
  @ApiForbiddenResponse({ description: 'Chỉ admin, staff' })
  listAuditEvents(
    @Query() query: AuditEventsQueryDto
  ): Promise<AuditEventsPageResponseDto> {
    return this.auditQueryService.listEvents({
      page: query.page,
      limit: query.limit,
      contractId: query.contractId,
      eventType: query.eventType,
      state: query.state,
      verificationState: query.verificationState,
      from: query.from,
      to: query.to,
      txId: query.txId,
    })
  }

  /** Chi tiết sự kiện đã khử nhạy cảm — Admin, Nhân viên */
  @Get('audit/events/:id')
  @Roles('admin', 'staff')
  @ApiOperation({
    summary: 'Chi tiết sự kiện: phụ thuộc, xác minh ledger, liên kết Explorer',
  })
  @ApiOkResponse({ type: AuditEventDetailResponseDto })
  @ApiNotFoundResponse({ description: 'AUDIT_EVENT_NOT_FOUND' })
  getAuditEvent(
    @Param() params: AuditEventIdParamDto
  ): Promise<AuditEventDetailResponseDto> {
    return this.auditQueryService.getEvent(params.id)
  }

  // ── Reconciliation (PROP-399 D7/D9/D13): đọc = admin + staff; start/resume/cancel/repair = chỉ admin ──

  /** Bắt đầu một lần đối soát có giới hạn — chỉ Admin */
  @Post('reconciliation-runs')
  @Roles('admin')
  @ApiOperation({
    summary:
      'Bắt đầu đối soát có giới hạn (khoảng thời gian ≤ 92 ngày hoặc danh sách hợp đồng)',
  })
  @ApiCreatedResponse({ type: ReconciliationRunResponseDto })
  @ApiBadRequestResponse({
    description: 'RECONCILIATION_SCOPE_REQUIRED | RECONCILIATION_SCOPE_INVALID',
  })
  @ApiConflictResponse({ description: 'RECONCILIATION_SCOPE_LOCKED' })
  @ApiForbiddenResponse({ description: 'Chỉ admin' })
  async startReconciliationRun(
    @Body() dto: StartReconciliationRunDto,
    @CurrentUser('id') actorId: string
  ): Promise<ReconciliationRunResponseDto> {
    const run = await this.reconciliationService.startRun(dto, {
      id: actorId,
      role: 'admin',
    })
    return ReconciliationRunResponseDto.fromEntity(run)
  }

  /** Danh sách lần đối soát — Admin, Nhân viên */
  @Get('reconciliation-runs')
  @Roles('admin', 'staff')
  @ApiOperation({ summary: 'Danh sách lần đối soát (mới nhất trước)' })
  @ApiOkResponse({ type: ReconciliationRunsPageResponseDto })
  async listReconciliationRuns(
    @Query() query: ReconciliationRunListQueryDto
  ): Promise<ReconciliationRunsPageResponseDto> {
    const page = await this.reconciliationService.listRuns({
      page: query.page,
      limit: query.limit,
    })
    return {
      ...page,
      items: page.items.map(item =>
        ReconciliationRunResponseDto.fromEntity(item)
      ),
    }
  }

  /** Chi tiết lần đối soát và bộ đếm — Admin, Nhân viên */
  @Get('reconciliation-runs/:id')
  @Roles('admin', 'staff')
  @ApiOperation({ summary: 'Chi tiết lần đối soát' })
  @ApiOkResponse({ type: ReconciliationRunResponseDto })
  @ApiNotFoundResponse({ description: 'RECONCILIATION_RUN_NOT_FOUND' })
  async getReconciliationRun(
    @Param() params: ReconciliationRunIdParamDto
  ): Promise<ReconciliationRunResponseDto> {
    return ReconciliationRunResponseDto.fromEntity(
      await this.reconciliationService.getRun(params.id)
    )
  }

  /** Phát hiện của một lần đối soát (đã khử nhạy cảm) — Admin, Nhân viên */
  @Get('reconciliation-runs/:id/findings')
  @Roles('admin', 'staff')
  @ApiOperation({
    summary: 'Các phát hiện của lần đối soát, lọc theo nhóm/trạng thái',
  })
  @ApiOkResponse({ type: ReconciliationFindingsPageResponseDto })
  @ApiNotFoundResponse({ description: 'RECONCILIATION_RUN_NOT_FOUND' })
  async listReconciliationFindings(
    @Param() params: ReconciliationRunIdParamDto,
    @Query() query: ReconciliationFindingsQueryDto
  ): Promise<ReconciliationFindingsPageResponseDto> {
    const page = await this.reconciliationService.listFindings(params.id, {
      page: query.page,
      limit: query.limit,
      category: query.category,
      status: query.status,
    })
    return {
      ...page,
      items: page.items.map(item =>
        ReconciliationFindingResponseDto.fromEntity(item)
      ),
    }
  }

  /** Tiếp tục lần đối soát bị gián đoạn/thất bại từ checkpoint — chỉ Admin */
  @Post('reconciliation-runs/:id/resume')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tiếp tục từ checkpoint đã commit' })
  @ApiOkResponse({ type: ReconciliationRunResponseDto })
  @ApiConflictResponse({ description: 'RECONCILIATION_RUN_NOT_RESUMABLE' })
  async resumeReconciliationRun(
    @Param() params: ReconciliationRunIdParamDto,
    @CurrentUser('id') actorId: string
  ): Promise<ReconciliationRunResponseDto> {
    return ReconciliationRunResponseDto.fromEntity(
      await this.reconciliationService.resumeRun(params.id, {
        id: actorId,
        role: 'admin',
      })
    )
  }

  /** Hủy hợp tác một lần đối soát đang chờ/chạy — chỉ Admin */
  @Post('reconciliation-runs/:id/cancel')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hủy hợp tác (dừng ở ranh giới trang kế tiếp)' })
  @ApiOkResponse({ type: ReconciliationRunResponseDto })
  @ApiConflictResponse({ description: 'RECONCILIATION_RUN_NOT_CANCELLABLE' })
  async cancelReconciliationRun(
    @Param() params: ReconciliationRunIdParamDto,
    @CurrentUser('id') actorId: string
  ): Promise<ReconciliationRunResponseDto> {
    return ReconciliationRunResponseDto.fromEntity(
      await this.reconciliationService.cancelRun(params.id, {
        id: actorId,
        role: 'admin',
      })
    )
  }

  /** Sửa an toàn qua outbox (enqueue/retry), có lý do — chỉ Admin */
  @Post('reconciliation-findings/:id/repair')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Sửa phát hiện bằng cách tạo/retry outbox item (không bao giờ sửa trực tiếp ledger, tx id hay blockchain_logs)',
  })
  @ApiOkResponse({ type: RepairFindingResponseDto })
  @ApiNotFoundResponse({ description: 'RECONCILIATION_FINDING_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'LEDGER_FINDING_NOT_REPAIRABLE | LEDGER_FINDING_PRECONDITION_STALE',
  })
  async repairReconciliationFinding(
    @Param() params: ReconciliationFindingIdParamDto,
    @Body() dto: RepairFindingDto,
    @CurrentUser('id') actorId: string
  ): Promise<RepairFindingResponseDto> {
    const result = await this.reconciliationService.repairFinding(
      params.id,
      { id: actorId, role: 'admin' },
      dto.reason
    )
    return {
      finding: ReconciliationFindingResponseDto.fromEntity(result.finding),
      outboxId: result.outboxId,
      alreadyRepaired: result.alreadyRepaired,
    }
  }
}
