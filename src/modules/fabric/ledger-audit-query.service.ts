import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { BlockchainLog } from './schemas/blockchain-log.schema'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'
import { LedgerReconciliationRun } from './schemas/ledger-reconciliation-run.schema'
import { LedgerReconciliationFinding } from './schemas/ledger-reconciliation-finding.schema'
import { FabricService } from './fabric.service'
import {
  AUDIT_EVENT_TYPES,
  AUDIT_VERIFICATION_READS,
  AUDIT_WORKER_STALE_SECONDS,
  buildExplorerAction,
  deliveryState,
  localVerificationState,
  type AuditEventDetail,
  type AuditEventFilters,
  type AuditEventPage,
  type AuditEventSummary,
  type AuditOverview,
  type AuditWorkerHealth,
} from './ledger-audit-center.types'
import { ContractAuditEventDto } from '../contracts/dto/contract-audit-event.dto'

type MongoWhere = Record<string, unknown>
const asWhere = (where: MongoWhere): never => where as never
const SAFE_CODE = /^[A-Z0-9_-]{1,64}$/
const HEX_HASH = /^[a-f0-9]{64}$/i
const MISMATCH_LOOKUP_LIMIT = 200

@Injectable()
export class LedgerAuditQueryService {
  constructor(
    @InjectRepository(BlockchainLog)
    private readonly logRepository: Repository<BlockchainLog>,
    @InjectRepository(LedgerOutbox)
    private readonly outboxRepository: Repository<LedgerOutbox>,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly fabricService?: FabricService,
    @Optional()
    @InjectRepository(LedgerReconciliationRun)
    private readonly runRepository?: Repository<LedgerReconciliationRun>,
    @Optional()
    @InjectRepository(LedgerReconciliationFinding)
    private readonly findingRepository?: Repository<LedgerReconciliationFinding>
  ) {}

  // ── PROP-399 Audit Center read model (D6/D9) ─────────────────────────────

  async getWorkerHealth(): Promise<AuditWorkerHealth> {
    const oldest = await this.oldestOutbox({ status: 'pending' }, 'createdAt')
    if (!oldest) return { state: 'ready', oldestPendingAt: null }
    const ageSeconds = this.ageSeconds(oldest)
    return {
      state: ageSeconds > AUDIT_WORKER_STALE_SECONDS ? 'degraded' : 'ready',
      oldestPendingAt: oldest.toISOString(),
    }
  }

  async getOverview(): Promise<AuditOverview> {
    const status = this.fabricService?.getStatus()
    const count = (where: MongoWhere): Promise<number> =>
      this.outboxRepository.count({ where: asWhere(where) })

    const [
      pending,
      processing,
      retryable,
      succeeded,
      terminalFailure,
      oldestPending,
      oldestTerminal,
      worker,
      coverage,
      reconciliation,
    ] = await Promise.all([
      count({ status: 'pending', attempts: { $lte: 0 } }),
      count({ status: 'processing' }),
      count({ status: 'pending', attempts: { $gt: 0 } }),
      count({ status: 'confirmed' }),
      count({ status: 'failed' }),
      this.oldestOutbox({ status: 'pending' }, 'createdAt'),
      this.oldestOutbox({ status: 'failed' }, 'updatedAt'),
      this.getWorkerHealth(),
      this.getCoverage(),
      this.getReconciliationSummary(),
    ])

    const mode = status?.mode ?? 'simulation'
    const connectionState =
      status?.connectionState ??
      (mode === 'simulation' ? 'disabled' : 'unavailable')
    const ready = status?.ready ?? true
    const runtimeState =
      mode === 'simulation'
        ? 'simulation'
        : connectionState !== 'connected'
          ? 'unavailable'
          : ready
            ? 'live'
            : 'degraded'
    const explorerStatus = status?.explorer ?? {
      enabled: false,
      state: 'disabled' as const,
      publicUrl: null,
    }
    const explorerProbe = buildExplorerAction({
      template: this.explorerTemplate(),
      explorerState: explorerStatus.state,
      explorerEnabled: explorerStatus.enabled,
      networkMode: 'fabric',
      status: 'confirmed',
      txId: 'probe',
    })

    return {
      generatedAt: new Date().toISOString(),
      runtime: {
        mode,
        state: runtimeState,
        ready,
        connectionState,
        abiVersion: status?.gateway?.abiVersion ?? null,
        evidenceSchemaVersions: status?.evidenceSchemaVersions ?? [],
        errorCodes: status?.errorCodes ?? [],
      },
      outbox: {
        pending,
        processing,
        retryable,
        succeeded,
        terminalFailure,
        oldestPendingAt: oldestPending ? oldestPending.toISOString() : null,
        oldestPendingAgeSeconds: oldestPending
          ? this.ageSeconds(oldestPending)
          : null,
        oldestTerminalFailureAt: oldestTerminal
          ? oldestTerminal.toISOString()
          : null,
        oldestTerminalFailureAgeSeconds: oldestTerminal
          ? this.ageSeconds(oldestTerminal)
          : null,
      },
      worker,
      ledger: {
        height: status?.ledger?.height ?? null,
        currentBlockHash: status?.ledger?.currentBlockHash ?? null,
        observedAt: status?.ledger?.observedAt ?? null,
      },
      identityWarnings: (['writer', 'reader', 'operator'] as const).flatMap(
        role => {
          const identity = status?.identities?.[role]
          return identity?.state === 'expiring' || identity?.state === 'expired'
            ? [
                {
                  role,
                  state: identity.state,
                  expiresAt: identity.expiresAt,
                },
              ]
            : []
        }
      ),
      explorer: {
        enabled: explorerStatus.enabled,
        state: explorerStatus.state,
        available: explorerProbe.available,
        reason:
          explorerProbe.reason === 'NOT_COMMITTED_ON_FABRIC'
            ? null
            : explorerProbe.reason,
      },
      coverage,
      reconciliation,
    }
  }

  async listEvents(filters: AuditEventFilters): Promise<AuditEventPage> {
    const where = await this.buildEventWhere(filters)
    const [rows, total] = await this.outboxRepository.findAndCount({
      where: asWhere(where),
      order: { createdAt: 'DESC' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    })
    const context = this.explorerContext()
    return {
      items: rows.map(row => this.toSummary(row, context)),
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    }
  }

  async getEvent(id: string): Promise<AuditEventDetail> {
    const row = /^[a-f0-9]{24}$/i.test(id)
      ? await this.outboxRepository.findOne({
          where: asWhere({ _id: new ObjectId(id) }),
        })
      : null
    if (!row) {
      throw new NotFoundException({
        code: 'AUDIT_EVENT_NOT_FOUND',
        message: 'Không tìm thấy sự kiện sổ cái',
      })
    }
    const context = this.explorerContext()
    const summary = this.toSummary(row, context)
    return {
      ...summary,
      dependencies: await this.dependencyStates(row),
      explorer: buildExplorerAction({
        template: context.template,
        explorerState: context.state,
        explorerEnabled: context.enabled,
        networkMode: row.networkMode,
        status: row.status,
        txId: row.txHash,
      }),
      verification: await this.verifyEvent(row),
    }
  }

  private explorerTemplate(): string | undefined {
    return this.configService?.get<string>('fabric.explorerTxUrlTemplate')
  }

  private explorerContext(): {
    template: string | undefined
    state: 'disabled' | 'ready' | 'degraded' | undefined
    enabled: boolean
  } {
    const explorer = this.fabricService?.getStatus().explorer
    return {
      template: this.explorerTemplate(),
      state: explorer?.state,
      enabled: explorer?.enabled ?? false,
    }
  }

  private ageSeconds(date: Date): number {
    return Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  }

  private async oldestOutbox(
    where: MongoWhere,
    field: 'createdAt' | 'updatedAt'
  ): Promise<Date | null> {
    const [oldest] = await this.outboxRepository.find({
      where: asWhere(where),
      order: { [field]: 'ASC' },
      take: 1,
    })
    if (!oldest) return null
    return oldest[field] ?? oldest.createdAt ?? null
  }

  private async getCoverage(): Promise<AuditOverview['coverage']> {
    const count = (where: MongoWhere): Promise<number> =>
      this.outboxRepository.count({ where: asWhere(where) })
    return Promise.all(
      AUDIT_EVENT_TYPES.map(async eventType => {
        const [total, pending, confirmed, failed] = await Promise.all([
          count({ eventType }),
          count({ eventType, status: { $in: ['pending', 'processing'] } }),
          count({ eventType, status: 'confirmed' }),
          count({ eventType, status: 'failed' }),
        ])
        return { eventType, total, pending, confirmed, failed }
      })
    )
  }

  private async getReconciliationSummary(): Promise<
    AuditOverview['reconciliation']
  > {
    if (!this.runRepository || !this.findingRepository) {
      return { latestRun: null, openFindings: 0 }
    }
    const [[latest], openFindings] = await Promise.all([
      this.runRepository.find({ order: { createdAt: 'DESC' }, take: 1 }),
      this.findingRepository.count({ where: asWhere({ status: 'open' }) }),
    ])
    return {
      latestRun: latest
        ? {
            id: latest._id.toHexString(),
            status: latest.status,
            startedAt: latest.startedAt?.toISOString() ?? null,
            completedAt: latest.completedAt?.toISOString() ?? null,
            counters: { ...latest.counters },
          }
        : null,
      openFindings,
    }
  }

  private invalidFilter(reason: string): BadRequestException {
    return new BadRequestException({
      code: 'AUDIT_FILTER_INVALID',
      message: reason,
    })
  }

  private async buildEventWhere(
    filters: AuditEventFilters
  ): Promise<MongoWhere> {
    const clauses: MongoWhere[] = []

    if (filters.contractId) {
      clauses.push({
        $or: [
          { contractId: filters.contractId },
          { aggregateType: 'contract', aggregateId: filters.contractId },
        ],
      })
    }
    if (filters.eventType) clauses.push({ eventType: filters.eventType })
    if (filters.txId) clauses.push({ txHash: filters.txId })

    switch (filters.state) {
      case 'pending':
        clauses.push({ status: 'pending', attempts: { $lte: 0 } })
        break
      case 'retryable':
        clauses.push({ status: 'pending', attempts: { $gt: 0 } })
        break
      case 'processing':
        clauses.push({ status: 'processing' })
        break
      case 'confirmed':
        clauses.push({ status: 'confirmed' })
        break
      case 'failed':
        clauses.push({ status: 'failed' })
        break
      default:
        break
    }

    if (filters.from || filters.to) {
      const from = filters.from ? new Date(filters.from) : null
      const to = filters.to ? new Date(filters.to) : null
      if (
        (from && Number.isNaN(from.getTime())) ||
        (to && Number.isNaN(to.getTime()))
      ) {
        throw this.invalidFilter('Khoảng thời gian không hợp lệ')
      }
      if (from && to && from.getTime() > to.getTime()) {
        throw this.invalidFilter('from phải nhỏ hơn hoặc bằng to')
      }
      clauses.push({
        createdAt: {
          ...(from ? { $gte: from } : {}),
          ...(to ? { $lte: to } : {}),
        },
      })
    }

    switch (filters.verificationState) {
      case 'verified':
        clauses.push({
          status: 'confirmed',
          networkMode: 'fabric',
          txHash: { $ne: null },
        })
        break
      case 'unavailable':
        clauses.push({ status: 'confirmed', networkMode: 'simulation' })
        break
      case 'not-recorded':
        clauses.push({ status: { $ne: 'confirmed' } })
        break
      case 'mismatch': {
        const findings = this.findingRepository
          ? await this.findingRepository.find({
              where: asWhere({
                status: 'open',
                category: 'hash_schema_mismatch',
              }),
              take: MISMATCH_LOOKUP_LIMIT,
            })
          : []
        clauses.push({
          aggregateId: { $in: findings.map(finding => finding.aggregateId) },
        })
        break
      }
      default:
        break
    }

    return clauses.length > 0 ? { $and: clauses } : {}
  }

  private toSummary(
    row: LedgerOutbox,
    context: ReturnType<LedgerAuditQueryService['explorerContext']>
  ): AuditEventSummary {
    const networkMode: 'fabric' | 'simulation' =
      row.networkMode === 'simulation'
        ? 'simulation'
        : row.networkMode === 'fabric'
          ? 'fabric'
          : this.fabricService?.getStatus().mode === 'simulation'
            ? 'simulation'
            : 'fabric'
    const explorer = buildExplorerAction({
      template: context.template,
      explorerState: context.state,
      explorerEnabled: context.enabled,
      networkMode: row.networkMode,
      status: row.status,
      txId: row.txHash,
    })
    return {
      id: row._id.toHexString(),
      eventType: row.eventType,
      aggregateType: row.aggregateType,
      aggregateRef: row.aggregateId.replace(/[^a-zA-Z0-9]/g, '').slice(-6),
      contractId:
        row.contractId ??
        (row.aggregateType === 'contract' ? row.aggregateId : null),
      status: deliveryState(row),
      verificationState: localVerificationState(row),
      networkMode,
      txId: row.txHash ?? null,
      // Số khối chỉ hiển thị cho Fabric thật và khi hợp lệ (> 0).
      blockNumber:
        row.networkMode === 'fabric' &&
        row.blockNumber != null &&
        row.blockNumber > 0
          ? row.blockNumber
          : null,
      explorerUrl: explorer.url,
      payloadHash: HEX_HASH.test(row.payloadHash)
        ? row.payloadHash.toLowerCase()
        : '',
      attempts: Number.isFinite(row.attempts) ? row.attempts : 0,
      failureCode:
        typeof row.errorCode === 'string' && SAFE_CODE.test(row.errorCode)
          ? row.errorCode
          : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: (row.updatedAt ?? row.createdAt).toISOString(),
      recordedAt: row.confirmedAt?.toISOString() ?? null,
    }
  }

  private async dependencyStates(
    row: LedgerOutbox
  ): Promise<AuditEventDetail['dependencies']> {
    const keys =
      Array.isArray(row.dependencyKeys) && row.dependencyKeys.length > 0
        ? row.dependencyKeys
        : row.dependencyKey
          ? [row.dependencyKey]
          : []
    const states: AuditEventDetail['dependencies'] = []
    for (const key of keys) {
      const [aggregateType, aggregateId, eventType] = key.split(':')
      if (!aggregateType || !aggregateId || !eventType) continue
      const parent = await this.outboxRepository.findOne({
        where: asWhere({ aggregateType, aggregateId, eventType }),
      })
      states.push({
        key: `${aggregateType}:${aggregateId.replace(/[^a-zA-Z0-9]/g, '').slice(-6)}:${eventType}`,
        state: parent ? parent.status : 'missing',
      })
    }
    return states
  }

  /** Xác minh theo yêu cầu bằng đọc khoá trực tiếp trên ledger (không quét, không ghi). */
  private async verifyEvent(
    row: LedgerOutbox
  ): Promise<AuditEventDetail['verification']> {
    if (row.status !== 'confirmed') {
      return { status: 'not-recorded', reason: null }
    }
    if (
      row.networkMode === 'simulation' ||
      this.fabricService?.getStatus().mode === 'simulation'
    ) {
      return { status: 'unavailable', reason: 'FABRIC_SIMULATION_MODE' }
    }
    const read = AUDIT_VERIFICATION_READS[row.eventType]
    const expected = read ? row.payload?.args?.[read.argIndex] : undefined
    if (!read || !this.fabricService || typeof expected !== 'string') {
      return { status: 'unavailable', reason: 'VERIFICATION_NOT_SUPPORTED' }
    }
    try {
      const record = (await this.fabricService.evaluateTransaction(
        read.action,
        [row.aggregateId]
      )) as Record<string, unknown> | null
      return record && record[read.hashField] === expected
        ? { status: 'verified', reason: null }
        : { status: 'mismatch', reason: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ERR_NOT_FOUND') || /không tồn tại/i.test(message)) {
        return { status: 'not-recorded', reason: null }
      }
      return {
        status: 'unavailable',
        reason: message.includes('FABRIC_GATEWAY_UNAVAILABLE')
          ? 'FABRIC_UNAVAILABLE'
          : 'FABRIC_QUERY_FAILED',
      }
    }
  }

  /**
   * Truy vấn và tổng hợp danh sách sự kiện audit cho hợp đồng
   */
  async getContractEvents(
    contractId: string
  ): Promise<ContractAuditEventDto[]> {
    const [logs, outboxList] = await Promise.all([
      this.logRepository.find({
        where: { contractId },
        order: { createdAt: 'DESC' },
      }),
      this.outboxRepository.find({
        where: { aggregateId: contractId },
        order: { createdAt: 'DESC' },
      }),
    ])

    const events: ContractAuditEventDto[] = []

    // 1. Map từ Ledger Outbox (Trạng thái đẩy sổ cái)
    for (const outbox of outboxList) {
      const networkMode: 'simulation' | 'fabric' =
        outbox.networkMode ??
        (this.configService?.get<boolean>('fabric.enabled')
          ? 'fabric'
          : 'simulation')
      events.push({
        id: `outbox-${outbox._id.toString()}`,
        category: 'ledger',
        eventType: outbox.eventType || 'ledger.sync',
        status: outbox.status,
        occurredAt: outbox.updatedAt
          ? outbox.updatedAt.toISOString()
          : outbox.createdAt.toISOString(),
        actorRole: 'system',
        networkMode,
        txHash: outbox.txHash ?? null,
        // Chỉ hiển thị số khối nếu là Fabric thật và có số khối hợp lệ > 0
        blockNumber:
          networkMode === 'fabric' &&
          outbox.blockNumber != null &&
          outbox.blockNumber > 0
            ? outbox.blockNumber
            : null,
        retryable: false,
        displayCode: `LEDGER_${outbox.status.toUpperCase()}`,
        description: this.getOutboxDescription(outbox),
      })
    }

    // 2. Map từ Blockchain Logs
    for (const log of logs) {
      const isSim = log.networkMode === 'simulation'
      events.push({
        id: `log-${log._id.toString()}`,
        category: this.resolveCategory(log.eventType || log.action),
        eventType: log.eventType || log.action,
        status:
          (log.status as
            | 'pending'
            | 'processing'
            | 'confirmed'
            | 'failed'
            | 'informational') || 'confirmed',
        occurredAt: log.createdAt
          ? log.createdAt.toISOString()
          : new Date().toISOString(),
        actorRole: 'system',
        networkMode: log.networkMode || 'simulation',
        txHash: log.txHash || null,
        blockNumber:
          isSim || log.blockNumber == null || log.blockNumber <= 0
            ? null
            : log.blockNumber,

        retryable: false,
        displayCode: `LOG_${(log.status || 'CONFIRMED').toUpperCase()}`,
        description: this.getLogDescription(log),
      })
    }

    // Sort ổn định theo thời gian giảm dần
    return events.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    )
  }

  private resolveCategory(
    action: string
  ): 'contract' | 'signature' | 'deposit' | 'payment' | 'ledger' {
    // PROP-399: nhóm bằng chứng mới có nhãn riêng, không rơi vào nhóm 'ledger' chung
    // (nhóm này quyết định trạng thái sổ cái tổng hợp của hợp đồng).
    if (action === 'recordMoveInSettlement') return 'payment'
    if (action === 'recordHandover' || action === 'publishGovernanceSnapshot') {
      return 'contract'
    }
    if (action.includes('deposit')) return 'deposit'
    if (action.includes('sign')) return 'signature'
    if (action.includes('pay')) return 'payment'
    if (action.includes('contract')) return 'contract'
    return 'ledger'
  }

  private getOutboxDescription(outbox: LedgerOutbox): string {
    switch (outbox.status) {
      case 'pending':
        if (outbox.errorCode === 'DEPENDENCY_PENDING') {
          return 'Đang chờ bằng chứng tiền đề được ghi nhận lên sổ cái trước khi đồng bộ'
        }
        if (outbox.errorCode === 'CHAINCODE_UPGRADE_REQUIRED') {
          return 'Đang chờ chaincode trên mạng Fabric được nâng cấp để hỗ trợ bản ghi này'
        }
        return 'Giao dịch đang chờ hàng đợi xử lý ghi nhận lên sổ cái'
      case 'processing':
        return 'Hệ thống đang thực hiện đồng bộ dữ liệu vào mạng lưới Hyperledger Fabric'
      case 'confirmed':
        return 'Giao dịch đã được đồng bộ thành công vào sổ cái Blockchain'
      case 'failed':
        return 'Đồng bộ sổ cái thất bại vĩnh viễn; cần nhân viên hoặc quản trị viên xử lý hoặc retry thủ công'
      default:
        return 'Đang theo dõi tiến trình đồng bộ sổ cái'
    }
  }

  private getLogDescription(log: BlockchainLog): string {
    const isSim = log.networkMode === 'simulation'
    const suffix = isSim ? ' (Chế độ mô phỏng)' : ''
    switch (log.action) {
      case 'createContract':
        return `Khởi tạo và neo mã băm hợp đồng trên sổ cái Fabric${suffix}`
      case 'recordDeposit':
        return `Ghi nhận xác nhận đặt cọc bảo đảm lên sổ cái${suffix}`
      case 'terminateContract':
        return `Ghi nhận thanh lý/chấm dứt hợp đồng trên sổ cái${suffix}`
      case 'recordMoveInSettlement':
        return `Ghi nhận quyết toán nhận nhà (đã thanh toán đủ) trên sổ cái${suffix}`
      case 'recordHandover':
        return `Ghi nhận biên bản bàn giao nhận nhà đã hoàn tất trên sổ cái${suffix}`
      case 'publishGovernanceSnapshot':
        return `Neo phiên bản cấu hình pháp lý và quản trị áp dụng cho hợp đồng lên sổ cái${suffix}`
      default:
        return `Giao dịch ${log.action} được ghi nhận trên sổ cái${suffix}`
    }
  }
}
