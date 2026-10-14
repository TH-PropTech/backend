import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ModuleRef } from '@nestjs/core'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { Contract } from '../../contracts/schemas/contract.schema'
import { DepositAgreement } from '../../contracts/schemas/deposit-agreement.schema'
import { Payment } from '../../payments/schemas/payment.schema'
import { MoveInSettlement } from '../../rental/schemas/move-in-settlement.schema'
import { MoveInSettlementsService } from '../../rental/services/move-in-settlements.service'
import { sha256Hex } from '../utils/canonical-json'
import { FabricGovernanceService } from './fabric-governance.service'
import { FabricService } from './fabric.service'
import { LedgerOutboxService } from './ledger-outbox.service'
import {
  RECONCILIATION_EVENT_TYPES,
  buildReconciliationSources,
  type ExpectedEvent,
  type ReconciliationSource,
} from '../utils/ledger-reconciliation.sources'
import { FabricGovernanceSnapshot } from '../schemas/fabric-governance-snapshot.schema'
import { LedgerOutbox } from '../schemas/ledger-outbox.schema'
import {
  LedgerReconciliationFinding,
  type LedgerReconciliationFindingCategory,
  type LedgerReconciliationFindingStatus,
} from '../schemas/ledger-reconciliation-finding.schema'
import {
  LedgerReconciliationRun,
  type LedgerReconciliationCheckpoint,
  type LedgerReconciliationCounters,
  type LedgerReconciliationScope,
} from '../schemas/ledger-reconciliation-run.schema'

export type ReconciliationActor = { id: string; role: string }
export type ReconciliationScopeInput = {
  from?: string | Date | undefined
  to?: string | Date | undefined
  contractIds?: string[] | undefined
  eventTypes?: string[] | undefined
}

export type ReconciliationPage<T> = {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export type RepairResult = {
  finding: LedgerReconciliationFinding
  outboxId: string
  alreadyRepaired: boolean
}

const MAX_RANGE_DAYS = 92
const MAX_PAGE_SIZE = 100
const RUN_LEASE_MS = 5 * 60 * 1000
const MIN_REASON_LENGTH = 5
const OBJECT_ID = /^[a-f0-9]{24}$/i
const ORPHAN_PHASE_PREFIX = 'orphan-scan:'
const BUDGET_EXHAUSTED = 'ORPHAN_SCAN_BUDGET_EXHAUSTED'

type Where = Record<string, unknown>
const asWhere = (where: Where): never => where as never

type Phase =
  | { id: string; kind: 'events'; source: ReconciliationSource }
  | {
      id: string
      kind: 'orphans'
      source: ReconciliationSource
      prefix: string
    }

type RunContext = {
  simulation: boolean
  unavailable: boolean
  lastErrorCode: string | null
  orphanPages: number
  pageSize: number
  orphanBudget: number
}

type PageResult = {
  counters: LedgerReconciliationCounters
  position: string | null
  done: boolean
  budgetExhausted?: boolean
}

type LedgerCheck =
  | { result: 'skipped' | 'match' | 'missing' | 'unavailable' | 'simulation' }
  | { result: 'mismatch'; observedHash: string | null }

type Outcome =
  | { kind: 'consistent' }
  | { kind: 'inflight' }
  | { kind: 'unverifiable-simulation' }
  | {
      kind: 'finding'
      category: LedgerReconciliationFindingCategory
      observedHash?: string | null
    }

@Injectable()
export class LedgerReconciliationService {
  private readonly logger = new Logger(LedgerReconciliationService.name)
  private readonly sources: ReconciliationSource[]

  constructor(
    @InjectRepository(LedgerReconciliationRun)
    private readonly runRepository: Repository<LedgerReconciliationRun>,
    @InjectRepository(LedgerReconciliationFinding)
    private readonly findingRepository: Repository<LedgerReconciliationFinding>,
    @InjectRepository(LedgerOutbox)
    private readonly outboxRepository: Repository<LedgerOutbox>,
    @InjectRepository(Contract)
    contractRepository: Repository<Contract>,
    @InjectRepository(DepositAgreement)
    depositRepository: Repository<DepositAgreement>,
    @InjectRepository(Payment)
    paymentRepository: Repository<Payment>,
    @InjectRepository(MoveInSettlement)
    settlementRepository: Repository<MoveInSettlement>,
    @InjectRepository(FabricGovernanceSnapshot)
    snapshotRepository: Repository<FabricGovernanceSnapshot>,
    private readonly fabricService: FabricService,
    private readonly outboxService: LedgerOutboxService,
    private readonly governanceService: FabricGovernanceService,
    private readonly configService: ConfigService,
    // MoveInSettlementsModule import FabricModule → tra cứu lazy để không tạo vòng module.
    private readonly moduleRef: ModuleRef
  ) {
    this.sources = buildReconciliationSources({
      contracts: contractRepository,
      deposits: depositRepository,
      payments: paymentRepository,
      settlements: settlementRepository,
      snapshots: snapshotRepository,
    })
  }

  // ── Run lifecycle ────────────────────────────────────────────────────────

  async startRun(
    input: ReconciliationScopeInput,
    actor: ReconciliationActor,
    options: { process?: boolean } = {}
  ): Promise<LedgerReconciliationRun> {
    this.assertAdmin(actor)
    const { scope, scopeHash } = this.normalizeScope(input)

    const active = await this.runRepository.findOne({
      where: asWhere({ scopeHash, status: { $in: ['queued', 'running'] } }),
    })
    if (active) {
      throw new ConflictException({
        code: 'RECONCILIATION_SCOPE_LOCKED',
        message: 'Đã có một lần đối soát đang chạy cho phạm vi này',
      })
    }

    const run = await this.runRepository.save(
      this.runRepository.create({
        scopeHash,
        scope,
        status: 'queued',
        checkpoint: null,
        counters: { examined: 0, consistent: 0, findings: 0, unverifiable: 0 },
        requestedBy: actor.id,
        startedAt: null,
        completedAt: null,
        lastErrorCode: null,
      })
    )
    if (options.process !== false) this.schedule(run._id.toHexString())
    return run
  }

  async resumeRun(
    id: string,
    actor: ReconciliationActor,
    options: { process?: boolean } = {}
  ): Promise<LedgerReconciliationRun> {
    this.assertAdmin(actor)
    const run = await this.getRun(id)
    const stale =
      run.status === 'running' &&
      Date.now() - (run.updatedAt ?? run.createdAt).getTime() > RUN_LEASE_MS
    const budgetResumable =
      run.status === 'completed-with-findings' &&
      run.lastErrorCode === BUDGET_EXHAUSTED &&
      run.checkpoint !== null
    if (run.status !== 'failed' && !stale && !budgetResumable) {
      throw new ConflictException({
        code: 'RECONCILIATION_RUN_NOT_RESUMABLE',
        message: 'Lần đối soát này không thể tiếp tục',
      })
    }
    await this.runRepository.update(asWhere({ _id: run._id }), {
      status: 'queued',
      lastErrorCode: null,
      completedAt: null,
    } as never)
    if (options.process !== false) this.schedule(id)
    return this.getRun(id)
  }

  async cancelRun(
    id: string,
    actor: ReconciliationActor
  ): Promise<LedgerReconciliationRun> {
    this.assertAdmin(actor)
    const run = await this.getRun(id)
    if (run.status !== 'queued' && run.status !== 'running') {
      throw new ConflictException({
        code: 'RECONCILIATION_RUN_NOT_CANCELLABLE',
        message: 'Chỉ có thể hủy lần đối soát đang chờ hoặc đang chạy',
      })
    }
    // Hủy hợp tác: processRun kiểm tra trạng thái trước mỗi trang.
    await this.runRepository.update(
      asWhere({ _id: run._id, status: { $in: ['queued', 'running'] } }),
      { status: 'cancelled', completedAt: new Date() } as never
    )
    return this.getRun(id)
  }

  async getRun(id: string): Promise<LedgerReconciliationRun> {
    const run = OBJECT_ID.test(id)
      ? await this.runRepository.findOne({
          where: asWhere({ _id: new ObjectId(id) }),
        })
      : null
    if (!run) {
      throw new NotFoundException({
        code: 'RECONCILIATION_RUN_NOT_FOUND',
        message: 'Không tìm thấy lần đối soát',
      })
    }
    return run
  }

  async listRuns(query: {
    page: number
    limit: number
  }): Promise<ReconciliationPage<LedgerReconciliationRun>> {
    const [items, total] = await this.runRepository.findAndCount({
      order: { _id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    })
    return this.page(items, total, query)
  }

  async listFindings(
    runId: string,
    query: {
      page: number
      limit: number
      category?: LedgerReconciliationFindingCategory | undefined
      status?: LedgerReconciliationFindingStatus | undefined
    }
  ): Promise<ReconciliationPage<LedgerReconciliationFinding>> {
    await this.getRun(runId)
    const where: Where = { runId }
    if (query.category) where.category = query.category
    if (query.status) where.status = query.status
    const [items, total] = await this.findingRepository.findAndCount({
      where: asWhere(where),
      order: { lastSeenAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    })
    return this.page(items, total, query)
  }

  // ── Processing ───────────────────────────────────────────────────────────

  private schedule(runId: string): void {
    void this.processRun(runId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Reconciliation run [${runId}] crashed: ${message}`)
    })
  }

  async processRun(runId: string): Promise<LedgerReconciliationRun> {
    let run = await this.getRun(runId)
    if (run.status === 'queued') {
      const claim = await this.runRepository.update(
        asWhere({ _id: run._id, status: 'queued' }),
        { status: 'running', startedAt: run.startedAt ?? new Date() } as never
      )
      if (!claim?.affected) return this.getRun(runId)
      run = await this.getRun(runId)
    }
    if (run.status !== 'running') return run

    const context: RunContext = {
      simulation: this.fabricService.getStatus().mode === 'simulation',
      unavailable: false,
      lastErrorCode: null,
      orphanPages: 0,
      pageSize: this.pageSize(),
      orphanBudget: this.configNumber('orphanPageBudget', 10),
    }
    const counters: LedgerReconciliationCounters = { ...run.counters }
    let exhausted = false

    try {
      const phases = this.buildPhases(run.scope, context)
      const startIndex = Math.max(
        0,
        phases.findIndex(phase => phase.id === run.checkpoint?.eventType)
      )
      const startPosition = run.checkpoint?.lastAggregateId || null

      phaseLoop: for (
        let index = startIndex;
        index < phases.length;
        index += 1
      ) {
        const phase = phases[index] as Phase
        let position = index === startIndex ? startPosition : null
        let phaseDone = false

        while (!phaseDone) {
          if (await this.isCancelled(run._id)) return this.getRun(runId)

          const result =
            phase.kind === 'events'
              ? await this.processEventPage(
                  run,
                  phase.source,
                  position,
                  context
                )
              : await this.processOrphanPage(run, phase, position, context)

          this.addCounters(counters, result.counters)
          const next = phases[index + 1]
          const checkpoint: LedgerReconciliationCheckpoint = result.done
            ? next
              ? { eventType: next.id, lastAggregateId: '' }
              : null
            : { eventType: phase.id, lastAggregateId: result.position ?? '' }
          // Chỉ ghi tiến độ, không bao giờ ghi đè `status` (một lệnh hủy đồng thời phải thắng).
          await this.runRepository.update(asWhere({ _id: run._id }), {
            counters: { ...counters },
            checkpoint,
          })
          position = result.position
          phaseDone = result.done
          if (result.budgetExhausted) {
            exhausted = true
            context.lastErrorCode = BUDGET_EXHAUSTED
            break phaseLoop
          }
        }
      }

      await this.runRepository.update(
        asWhere({ _id: run._id, status: 'running' }),
        {
          status:
            counters.findings > 0 ? 'completed-with-findings' : 'completed',
          completedAt: new Date(),
          lastErrorCode: exhausted ? BUDGET_EXHAUSTED : context.lastErrorCode,
        } as never
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Reconciliation run [${runId}] failed: ${message}`)
      await this.runRepository.update(
        asWhere({ _id: run._id, status: 'running' }),
        {
          status: 'failed',
          lastErrorCode: 'RECONCILIATION_RUN_FAILED',
        } as never
      )
    }
    return this.getRun(runId)
  }

  private buildPhases(
    scope: LedgerReconciliationScope,
    context: RunContext
  ): Phase[] {
    const selected = scope.eventTypes
    const sources = this.sources.filter(
      source => !selected || selected.includes(source.eventType)
    )
    const phases: Phase[] = sources.map(source => ({
      id: source.eventType,
      kind: 'events' as const,
      source,
    }))
    // Orphan detection chỉ chạy khi scope nêu rõ event types (D7) và có ledger thật để hỏi.
    if (selected && !context.simulation) {
      for (const source of sources) {
        if (source.ledgerPrefix) {
          phases.push({
            id: `${ORPHAN_PHASE_PREFIX}${source.ledgerPrefix}`,
            kind: 'orphans',
            source,
            prefix: source.ledgerPrefix,
          })
        }
      }
    }
    return phases
  }

  private async isCancelled(id: ObjectId): Promise<boolean> {
    const fresh = await this.runRepository.findOne({
      where: asWhere({ _id: id }),
    })
    return fresh?.status === 'cancelled'
  }

  private addCounters(
    target: LedgerReconciliationCounters,
    add: LedgerReconciliationCounters
  ): void {
    target.examined += add.examined
    target.consistent += add.consistent
    target.findings += add.findings
    target.unverifiable += add.unverifiable
  }

  private async processEventPage(
    run: LedgerReconciliationRun,
    source: ReconciliationSource,
    position: string | null,
    context: RunContext
  ): Promise<PageResult> {
    const { rows, lastId } = await source.page({
      scope: run.scope,
      afterId: position,
      take: context.pageSize,
    })
    const counters: LedgerReconciliationCounters = {
      examined: 0,
      consistent: 0,
      findings: 0,
      unverifiable: 0,
    }
    const runId = run._id.toHexString()

    for (const row of rows) {
      counters.examined += 1
      const outcome = await this.evaluate(source, row, context)
      if (outcome.kind === 'consistent') {
        counters.consistent += 1
        await this.autoResolve(row, runId)
      } else if (outcome.kind === 'unverifiable-simulation') {
        counters.unverifiable += 1
      } else if (outcome.kind === 'finding') {
        await this.upsertFinding(runId, source, row, outcome)
        counters.findings += 1
        if (outcome.category === 'unverifiable') counters.unverifiable += 1
      }
    }
    return {
      counters,
      position: lastId ?? position,
      done: rows.length < context.pageSize,
    }
  }

  private async evaluate(
    source: ReconciliationSource,
    row: ExpectedEvent,
    context: RunContext
  ): Promise<Outcome> {
    const outbox = await this.outboxRepository.findOne({
      where: asWhere({
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
      }),
    })

    if (!outbox) {
      return {
        kind: 'finding',
        category:
          row.projection === 'confirmed'
            ? 'orphan_local_projection'
            : 'missing_delivery_work',
      }
    }
    if (outbox.status === 'failed') {
      return { kind: 'finding', category: 'terminal_delivery_failure' }
    }
    if (outbox.status !== 'confirmed') {
      return (outbox.attempts ?? 0) > 0
        ? { kind: 'finding', category: 'retryable_delivery_failure' }
        : { kind: 'inflight' }
    }
    if (row.projection !== 'confirmed') {
      return { kind: 'finding', category: 'missing_local_projection' }
    }

    const ledger = await this.checkLedger(source, row, context)
    switch (ledger.result) {
      case 'missing':
        return { kind: 'finding', category: 'missing_ledger_evidence' }
      case 'mismatch':
        return {
          kind: 'finding',
          category: 'hash_schema_mismatch',
          observedHash: ledger.observedHash,
        }
      case 'unavailable':
        return { kind: 'finding', category: 'unverifiable' }
      case 'simulation':
        return { kind: 'unverifiable-simulation' }
      default:
        return { kind: 'consistent' }
    }
  }

  private async checkLedger(
    source: ReconciliationSource,
    row: ExpectedEvent,
    context: RunContext
  ): Promise<LedgerCheck> {
    if (!source.ledgerRead) return { result: 'skipped' }
    if (context.simulation) {
      context.lastErrorCode ??= 'FABRIC_SIMULATION_MODE'
      return { result: 'simulation' }
    }
    if (context.unavailable) return { result: 'unavailable' }
    try {
      const record = (await this.fabricService.evaluateTransaction(
        source.ledgerRead.action,
        [row.aggregateId]
      )) as Record<string, unknown> | null
      const observed = record?.[source.ledgerRead.hashField]
      return observed === row.expectedHash
        ? { result: 'match' }
        : {
            result: 'mismatch',
            observedHash: typeof observed === 'string' ? observed : null,
          }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ERR_NOT_FOUND') || /không tồn tại/i.test(message)) {
        return { result: 'missing' }
      }
      // Không thể kết luận "thiếu" khi không hỏi được Fabric → unverifiable và dừng gọi trong run này.
      context.unavailable = true
      context.lastErrorCode = 'FABRIC_UNAVAILABLE'
      return { result: 'unavailable' }
    }
  }

  private async processOrphanPage(
    run: LedgerReconciliationRun,
    phase: Extract<Phase, { kind: 'orphans' }>,
    bookmark: string | null,
    context: RunContext
  ): Promise<PageResult> {
    const counters: LedgerReconciliationCounters = {
      examined: 0,
      consistent: 0,
      findings: 0,
      unverifiable: 0,
    }
    const runId = run._id.toHexString()
    const empty = { counters, position: bookmark }

    if (context.unavailable) return { ...empty, done: true }

    if (context.orphanPages >= context.orphanBudget) {
      // Hết ngân sách trang trước khi hết tiền tố: unverifiable + vị trí có thể tiếp tục.
      await this.upsertFinding(
        runId,
        phase.source,
        {
          eventType: phase.source.eventType,
          aggregateType: 'ledger-scan',
          aggregateId: phase.prefix,
          contractId: null,
          expectedHash: null,
          projection: 'missing',
        },
        { kind: 'finding', category: 'unverifiable' }
      )
      counters.findings += 1
      counters.unverifiable += 1
      return { ...empty, done: false, budgetExhausted: true }
    }
    context.orphanPages += 1

    let listing: {
      keys?: Array<{ key: string; hash: string | null }>
      bookmark?: string
      hasMore?: boolean
    }
    try {
      listing = (await this.fabricService.evaluateTransaction(
        'listEvidenceKeys',
        [phase.prefix, String(context.pageSize), bookmark ?? '']
      )) as typeof listing
    } catch {
      context.unavailable = true
      context.lastErrorCode = 'FABRIC_UNAVAILABLE'
      return { ...empty, done: true }
    }

    for (const entry of listing.keys ?? []) {
      const id = entry.key.slice(phase.prefix.length)
      counters.examined += 1
      if (await phase.source.ownerExists(id)) {
        counters.consistent += 1
        continue
      }
      await this.upsertFinding(
        runId,
        phase.source,
        {
          eventType: phase.source.eventType,
          aggregateType: phase.source.aggregateType,
          aggregateId: id,
          contractId: null,
          expectedHash: null,
          projection: 'missing',
        },
        {
          kind: 'finding',
          category: 'orphan_ledger_evidence',
          observedHash: entry.hash ?? null,
        }
      )
      counters.findings += 1
    }
    return {
      counters,
      position: listing.bookmark ?? '',
      done: !listing.hasMore,
    }
  }

  // ── Findings ─────────────────────────────────────────────────────────────

  private async upsertFinding(
    runId: string,
    source: ReconciliationSource,
    row: ExpectedEvent,
    outcome: Extract<Outcome, { kind: 'finding' }>
  ): Promise<LedgerReconciliationFinding> {
    // fingerprint = category + aggregate + event type + phiên bản bằng chứng kỳ vọng (D7)
    const fingerprint = sha256Hex({
      category: outcome.category,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      eventType: row.eventType,
      evidenceVersion: source.evidenceVersion,
    })
    const now = new Date()
    const existing = await this.findingRepository.findOne({
      where: asWhere({ fingerprint }),
    })
    if (existing) {
      existing.runId = runId
      existing.lastSeenAt = now
      existing.expectedHash = row.expectedHash
      existing.observedHash = outcome.observedHash ?? null
      if (existing.status === 'resolved') {
        existing.status = 'open' // tái phát → mở lại
        existing.resolution = null
      }
      return this.findingRepository.save(existing)
    }
    return this.findingRepository.save(
      this.findingRepository.create({
        runId,
        fingerprint,
        contractId: row.contractId,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
        category: outcome.category,
        expectedHash: row.expectedHash,
        observedHash: outcome.observedHash ?? null,
        status: 'open',
        recoveryOutboxId: null,
        resolution: null,
        repair: null,
        firstSeenAt: now,
        lastSeenAt: now,
      })
    )
  }

  private async autoResolve(row: ExpectedEvent, runId: string): Promise<void> {
    const open = await this.findingRepository.find({
      where: asWhere({
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
        status: { $in: ['open', 'repair-pending'] },
      }),
    })
    for (const finding of open) {
      finding.status = 'resolved'
      finding.resolution = {
        actorId: 'system',
        reason: `RECONCILIATION_RUN:${runId}`,
        resolvedAt: new Date(),
      }
      await this.findingRepository.save(finding)
    }
  }

  async resolveFinding(
    id: string,
    actor: ReconciliationActor,
    reason: string,
    status: 'resolved' | 'accepted-risk' = 'resolved'
  ): Promise<LedgerReconciliationFinding> {
    this.assertAdmin(actor)
    const cleaned = this.requireReason(reason)
    const finding = await this.loadFinding(id)
    finding.status = status
    finding.resolution = {
      actorId: actor.id,
      reason: cleaned,
      resolvedAt: new Date(),
    }
    return this.findingRepository.save(finding)
  }

  // ── Repair: chỉ qua outbox enqueue/retryTerminal (D7) ───────────────────

  async repairFinding(
    id: string,
    actor: ReconciliationActor,
    reason: string
  ): Promise<RepairResult> {
    this.assertAdmin(actor)
    const cleaned = this.requireReason(reason)
    const finding = await this.loadFinding(id)

    if (finding.status === 'repair-pending' && finding.recoveryOutboxId) {
      return {
        finding,
        outboxId: finding.recoveryOutboxId,
        alreadyRepaired: true,
      }
    }
    if (finding.status !== 'open') throw this.notRepairable()

    let outboxId: string
    if (finding.category === 'missing_delivery_work') {
      outboxId = await this.requeueMissingWork(finding)
    } else if (finding.category === 'terminal_delivery_failure') {
      outboxId = await this.retryTerminalDelivery(finding)
    } else {
      throw this.notRepairable()
    }

    finding.status = 'repair-pending'
    finding.recoveryOutboxId = outboxId
    finding.repair = {
      actorId: actor.id,
      reason: cleaned,
      requestedAt: new Date(),
    }
    await this.findingRepository.save(finding)
    return { finding, outboxId, alreadyRepaired: false }
  }

  private async requeueMissingWork(
    finding: LedgerReconciliationFinding
  ): Promise<string> {
    let created: { _id: ObjectId } | null
    try {
      switch (finding.eventType) {
        case 'governance.published':
          created = await this.governanceService.ensureLedgerEvidenceQueued(
            finding.aggregateId
          )
          break
        case 'move-in.settled':
          created = await this.moveIn().ensureSettlementEvidenceQueued(
            finding.aggregateId
          )
          break
        case 'handover.completed':
          created = await this.moveIn().ensureHandoverEvidenceQueued(
            finding.aggregateId
          )
          break
        default:
          // Hợp đồng/đặt cọc/thanh toán cần dựng lại payload kích hoạt đầy đủ — không tự động hoá.
          throw this.notRepairable()
      }
    } catch (error) {
      if (error instanceof ConflictException) {
        const code = (error.getResponse() as { code?: string }).code
        if (code === 'LEDGER_FINDING_NOT_REPAIRABLE') throw error
        throw this.stale()
      }
      throw error
    }
    if (!created) throw this.stale()
    return created._id.toHexString()
  }

  private async retryTerminalDelivery(
    finding: LedgerReconciliationFinding
  ): Promise<string> {
    const outbox = await this.outboxRepository.findOne({
      where: asWhere({
        aggregateType: finding.aggregateType,
        aggregateId: finding.aggregateId,
        eventType: finding.eventType,
      }),
    })
    if (!outbox || outbox.status !== 'failed') throw this.stale()
    const retried = await this.outboxService.retryTerminal(
      outbox._id.toHexString(),
      'admin'
    )
    return (retried._id ?? outbox._id).toHexString()
  }

  private moveIn(): MoveInSettlementsService {
    return this.moduleRef.get(MoveInSettlementsService, { strict: false })
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private notRepairable(): ConflictException {
    return new ConflictException({
      code: 'LEDGER_FINDING_NOT_REPAIRABLE',
      message:
        'Phát hiện này không có cách sửa tự động an toàn; cần điều tra và ghi nhận xử lý',
    })
  }

  private stale(): ConflictException {
    return new ConflictException({
      code: 'LEDGER_FINDING_PRECONDITION_STALE',
      message: 'Điều kiện nghiệp vụ của phát hiện này không còn hợp lệ',
    })
  }

  private assertAdmin(actor: ReconciliationActor): void {
    if (actor.role !== 'admin') {
      throw new ForbiddenException(
        'Chỉ quản trị viên được thực hiện thao tác đối soát này'
      )
    }
  }

  private requireReason(reason: string | undefined): string {
    const cleaned = (reason ?? '').trim()
    if (cleaned.length < MIN_REASON_LENGTH) {
      throw new BadRequestException({
        code: 'RECONCILIATION_REASON_REQUIRED',
        message: `Cần nêu lý do (tối thiểu ${MIN_REASON_LENGTH} ký tự)`,
      })
    }
    return cleaned.slice(0, 500)
  }

  private async loadFinding(id: string): Promise<LedgerReconciliationFinding> {
    const finding = OBJECT_ID.test(id)
      ? await this.findingRepository.findOne({
          where: asWhere({ _id: new ObjectId(id) }),
        })
      : null
    if (!finding) {
      throw new NotFoundException({
        code: 'RECONCILIATION_FINDING_NOT_FOUND',
        message: 'Không tìm thấy phát hiện đối soát',
      })
    }
    return finding
  }

  private configNumber(key: string, fallback: number): number {
    const value = this.configService.get<number>(`fabric.reconciliation.${key}`)
    return typeof value === 'number' && value >= 1 ? value : fallback
  }

  private pageSize(): number {
    return Math.min(MAX_PAGE_SIZE, this.configNumber('pageSize', MAX_PAGE_SIZE))
  }

  private page<T>(
    items: T[],
    total: number,
    query: { page: number; limit: number }
  ): ReconciliationPage<T> {
    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    }
  }

  private invalidScope(reason: string): BadRequestException {
    return new BadRequestException({
      code: 'RECONCILIATION_SCOPE_INVALID',
      message: reason,
    })
  }

  private normalizeScope(input: ReconciliationScopeInput): {
    scope: LedgerReconciliationScope
    scopeHash: string
  } {
    const hasFrom =
      input.from !== undefined && input.from !== null && input.from !== ''
    const hasTo = input.to !== undefined && input.to !== null && input.to !== ''
    const hasContracts =
      Array.isArray(input.contractIds) && input.contractIds.length > 0
    const hasRange = hasFrom && hasTo

    if (!hasRange && !hasContracts) {
      throw new BadRequestException({
        code: 'RECONCILIATION_SCOPE_REQUIRED',
        message:
          'Cần khoảng thời gian có giới hạn (from và to) hoặc danh sách hợp đồng cụ thể',
      })
    }
    if (hasFrom !== hasTo && !hasContracts) {
      throw new BadRequestException({
        code: 'RECONCILIATION_SCOPE_REQUIRED',
        message: 'Khoảng thời gian cần cả from và to',
      })
    }

    const scope: LedgerReconciliationScope = {}
    if (hasFrom !== hasTo)
      throw this.invalidScope('Khoảng thời gian cần cả from và to')
    if (hasRange) {
      const from = new Date(input.from as string | Date)
      const to = new Date(input.to as string | Date)
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw this.invalidScope('Ngày không hợp lệ')
      }
      if (from.getTime() >= to.getTime()) {
        throw this.invalidScope('from phải nhỏ hơn to')
      }
      if (
        to.getTime() - from.getTime() >
        MAX_RANGE_DAYS * 24 * 60 * 60 * 1000
      ) {
        throw this.invalidScope(
          `Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày`
        )
      }
      scope.from = from
      scope.to = to
    }
    if (hasContracts) {
      const ids = [...new Set(input.contractIds)].map(id =>
        String(id).toLowerCase()
      )
      if (ids.some(id => !OBJECT_ID.test(id))) {
        throw this.invalidScope('Định danh hợp đồng không hợp lệ')
      }
      if (ids.length > this.configNumber('maxContracts', 500)) {
        throw this.invalidScope('Quá nhiều hợp đồng trong một lần đối soát')
      }
      scope.contractIds = ids.sort()
    }
    if (input.eventTypes && input.eventTypes.length > 0) {
      const types = [...new Set(input.eventTypes)]
      if (
        types.some(
          type =>
            !(RECONCILIATION_EVENT_TYPES as readonly string[]).includes(type)
        )
      ) {
        throw this.invalidScope('Loại sự kiện không được hỗ trợ')
      }
      scope.eventTypes = types.sort()
    }

    const scopeHash = sha256Hex({
      from: scope.from?.toISOString() ?? null,
      to: scope.to?.toISOString() ?? null,
      contractIds: scope.contractIds ?? null,
      eventTypes: scope.eventTypes ?? null,
    })
    return { scope, scopeHash }
  }
}
