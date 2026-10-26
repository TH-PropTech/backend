import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { Repository } from 'typeorm'
import { Contract } from '../../contracts/schemas/contract.schema'
import { sha256Hex } from '../../fabric/utils/canonical-json'
import { buildMoveInSettlementArgs } from '../../fabric/utils/ledger-action-args'
import {
  DepositSettlementStatement,
  type DepositRefundRecord,
  type DepositStatementAuditEntry,
  type DepositStatementLine,
} from '../schemas/deposit-settlement-statement.schema'
import { MoveOutHandover } from '../schemas/move-out-handover.schema'
import { DEPOSIT_REFUND_DUE_DAYS } from '../utils/deposit-refund.constants'
import {
  REFUND_REMINDER_LEAD_MS,
  addDays,
  assertPartyOrStaff,
  loadContract,
  pendingEvidence,
  resolveMoveOutResponseDays,
} from '../utils/move-out.util'
import { MoveOutSupportService } from './move-out-support.service'

type Statement = DepositSettlementStatement
type Role = 'tenant' | 'landlord'
const EVIDENCE_SCHEMA_VERSION = 1

export type StatementLineInput = {
  reason: string
  amount: number
  evidenceUrls?: string[]
}
export type LineResponseInput = {
  lineId: string
  decision: 'accept' | 'reject'
  note?: string
}
export type RefundInput = {
  amount: number
  transactionRef: string
  paidAt: string
  note?: string
}

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0)

/** Khoản chủ nhà phải hoàn: cọc trừ các dòng chưa bị khách phản đối. */
export const refundableAmount = (statement: Statement): number =>
  Math.max(
    0,
    statement.depositAmount -
      sum(
        statement.lines
          .filter(line => line.tenantResponse?.decision !== 'reject')
          .map(line => line.amount)
      )
  )

@Injectable()
export class DepositSettlementStatementsService {
  private readonly logger = new Logger(DepositSettlementStatementsService.name)

  constructor(
    @InjectRepository(DepositSettlementStatement)
    private readonly repo: Repository<Statement>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(MoveOutHandover)
    private readonly handoverRepo: Repository<MoveOutHandover>,
    private readonly support: MoveOutSupportService
  ) {}

  async findByContract(
    contractId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<Statement> {
    const statement = await this.findOrFail(contractId)
    assertPartyOrStaff(statement, actorId, isStaff, 'STATEMENT_ACCESS_DENIED')
    return statement
  }

  /** Lập hoặc thay toàn bộ dòng của bảng nháp. Bảng không có dòng nghĩa là hoàn đủ cọc. */
  async saveDraft(
    contractId: string,
    actorId: string,
    lines: StatementLineInput[],
    now = new Date()
  ): Promise<Statement> {
    const contract = await loadContract(this.contractRepo, contractId)
    if (actorId !== contract.landlordId)
      throw new ForbiddenException('STATEMENT_ACCESS_DENIED')
    const existing = await this.repo.findOne({ where: { contractId } })
    if (existing && existing.status !== 'draft')
      throw new ConflictException('STATEMENT_NOT_DRAFT')
    if (!existing) await this.assertHandoverCompleted(contractId)
    const depositAmount = existing?.depositAmount ?? contract.deposit
    const built = this.buildLines(lines)
    if (sum(built.map(line => line.amount)) > depositAmount)
      throw new BadRequestException('STATEMENT_DEDUCTION_EXCEEDS_DEPOSIT')
    const statement =
      existing ??
      this.repo.create({
        contractId,
        tenantId: contract.tenantId,
        landlordId: contract.landlordId,
        depositAmount,
        refunds: [],
        status: 'draft',
        responseDays: resolveMoveOutResponseDays(contract.packageSnapshot),
        statementHash: null,
        submittedAt: null,
        responseDueAt: null,
        acceptedAt: null,
        acceptedReason: null,
        refundDueAt: null,
        refundReminderSentAt: null,
        refundOverdueAt: null,
        closedAt: null,
        closeReason: null,
        dispute: null,
        auditLog: [],
        evidence: null,
      })
    statement.lines = built
    this.audit(statement, now, actorId, 'landlord', 'draft-saved')
    return this.repo.save(statement)
  }

  /** Chốt bảng: gửi cho khách, bắt đầu hạn phản hồi. Bảng không dòng thì coi như đã chấp nhận. */
  async submit(
    contractId: string,
    actorId: string,
    now = new Date()
  ): Promise<Statement> {
    const statement = await this.findOrFail(contractId)
    if (actorId !== statement.landlordId)
      throw new ForbiddenException('STATEMENT_ACCESS_DENIED')
    if (statement.status !== 'draft')
      throw new ConflictException('STATEMENT_NOT_DRAFT')
    await this.assertHandoverCompleted(contractId)
    statement.statementHash = this.hashOf(statement)
    statement.submittedAt = now
    statement.status = 'awaiting-tenant'
    statement.responseDueAt = addDays(now, statement.responseDays)
    this.audit(statement, now, actorId, 'landlord', 'submitted')
    if (statement.lines.length === 0)
      this.markAccepted(statement, now, 'no-deductions')
    await this.anchorStatement(statement, now)
    const saved = await this.repo.save(statement)
    const id = saved._id.toHexString()
    await this.support.recordEvent({
      contractId,
      eventType: 'deposit-statement.submitted',
      actorRole: 'landlord',
      actorId,
      refs: { settlementId: id, status: saved.status },
      transitionKey: `deposit-statement:${id}:submitted`,
    })
    await this.support.notify(
      [saved.tenantId],
      'Bảng khấu trừ cọc cần bạn phản hồi',
      saved.status === 'accepted'
        ? 'Chủ nhà đã gửi bảng khấu trừ cọc không có khoản khấu trừ nào.'
        : `Chủ nhà đã gửi bảng khấu trừ cọc. Vui lòng chấp nhận hoặc phản đối từng khoản trước ${saved.responseDueAt?.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}; quá hạn bảng được coi là đã chấp nhận.`,
      this.dataOf(saved)
    )
    return saved
  }

  async respond(
    contractId: string,
    actorId: string,
    responses: LineResponseInput[],
    now = new Date()
  ): Promise<Statement> {
    const statement = await this.findOrFail(contractId)
    if (actorId !== statement.tenantId)
      throw new ForbiddenException('STATEMENT_ACCESS_DENIED')
    if (statement.status !== 'awaiting-tenant')
      throw new ConflictException('STATEMENT_NOT_AWAITING_TENANT')
    if (statement.responseDueAt && new Date(statement.responseDueAt) <= now)
      throw new ConflictException('STATEMENT_RESPONSE_EXPIRED')
    for (const response of responses) {
      const line = statement.lines.find(item => item.id === response.lineId)
      if (!line) throw new NotFoundException('STATEMENT_LINE_NOT_FOUND')
      const note = response.note?.trim() || null
      if (response.decision === 'reject' && !note)
        throw new BadRequestException('STATEMENT_REJECT_NOTE_REQUIRED')
      line.tenantResponse = { decision: response.decision, note, at: now }
    }
    this.audit(statement, now, actorId, 'tenant', 'responded')
    const rejected = statement.lines.some(
      line => line.tenantResponse?.decision === 'reject'
    )
    if (rejected) statement.status = 'disputed'
    else if (statement.lines.every(line => line.tenantResponse))
      this.markAccepted(statement, now, 'tenant-accepted')
    const saved = await this.repo.save(statement)
    const id = saved._id.toHexString()
    await this.support.recordEvent({
      contractId,
      eventType: 'deposit-statement.tenant-responded',
      actorRole: 'tenant',
      actorId,
      refs: { settlementId: id, status: saved.status },
      transitionKey: `deposit-statement:${id}:responded:${saved.auditLog.length}`,
    })
    if (saved.status !== 'awaiting-tenant')
      await this.support.notify(
        [saved.landlordId],
        saved.status === 'disputed'
          ? 'Khách thuê phản đối bảng khấu trừ cọc'
          : 'Khách thuê đã chấp nhận bảng khấu trừ cọc',
        saved.status === 'disputed'
          ? 'Khách thuê đã phản đối một hoặc nhiều khoản khấu trừ. Hệ thống chỉ lưu chứng cứ, không phân xử.'
          : `Khách thuê đã chấp nhận bảng khấu trừ. Vui lòng hoàn cọc trước ${saved.refundDueAt?.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.`,
        this.dataOf(saved)
      )
    return saved
  }

  async dispute(
    contractId: string,
    actorId: string,
    note: string,
    now = new Date()
  ): Promise<Statement> {
    const statement = await this.findOrFail(contractId)
    const by = this.roleOf(statement, actorId)
    if (!by) throw new ForbiddenException('STATEMENT_ACCESS_DENIED')
    if (statement.status === 'disputed')
      throw new ConflictException('STATEMENT_ALREADY_DISPUTED')
    if (!['awaiting-tenant', 'accepted'].includes(statement.status))
      throw new ConflictException('STATEMENT_DISPUTE_NOT_ALLOWED')
    statement.status = 'disputed'
    statement.dispute = { by, note: note.trim(), at: now }
    this.audit(statement, now, actorId, by, 'disputed', note.trim())
    const saved = await this.repo.save(statement)
    const id = saved._id.toHexString()
    await this.support.recordEvent({
      contractId,
      eventType: 'deposit-statement.disputed',
      actorRole: by,
      actorId,
      refs: { settlementId: id },
      transitionKey: `deposit-statement:${id}:disputed`,
    })
    await this.support.notify(
      [by === 'tenant' ? saved.landlordId : saved.tenantId],
      'Bảng khấu trừ cọc đang có tranh chấp',
      'Một bên đã yêu cầu tranh chấp bảng khấu trừ cọc. Hệ thống chỉ lưu chứng cứ, không phân xử và không đổi số tiền.',
      this.dataOf(saved)
    )
    return saved
  }

  /** Khai báo của chủ nhà; sàn không chuyển tiền và không kiểm chứng giao dịch. */
  async recordRefund(
    contractId: string,
    actorId: string,
    input: RefundInput,
    now = new Date()
  ): Promise<Statement> {
    const statement = await this.findOrFail(contractId)
    if (actorId !== statement.landlordId)
      throw new ForbiddenException('STATEMENT_ACCESS_DENIED')
    if (!['accepted', 'disputed', 'refund-recorded'].includes(statement.status))
      throw new ConflictException('STATEMENT_REFUND_NOT_ALLOWED')
    const alreadyRefunded = sum(statement.refunds.map(item => item.amount))
    if (alreadyRefunded + input.amount > refundableAmount(statement))
      throw new BadRequestException('STATEMENT_REFUND_EXCEEDS_LIMIT')
    const refund: DepositRefundRecord = {
      id: randomUUID(),
      amount: input.amount,
      transactionRef: input.transactionRef.trim(),
      paidAt: new Date(input.paidAt),
      note: input.note?.trim() || null,
      recordedAt: now,
      recordedBy: actorId,
      tenantAcknowledgedAt: null,
      evidence: null,
    }
    statement.refunds = [...statement.refunds, refund]
    statement.status = 'refund-recorded'
    this.audit(
      statement,
      now,
      actorId,
      'landlord',
      'refund-recorded',
      refund.id
    )
    await this.anchorRefund(statement, refund, now)
    const saved = await this.repo.save(statement)
    const id = saved._id.toHexString()
    await this.support.recordEvent({
      contractId,
      eventType: 'deposit-statement.refund-recorded',
      actorRole: 'landlord',
      actorId,
      refs: { settlementId: id },
      transitionKey: `deposit-statement:${id}:refund:${refund.id}`,
    })
    await this.support.notify(
      [saved.tenantId],
      'Chủ nhà đã ghi nhận hoàn cọc',
      'Chủ nhà khai báo đã hoàn một khoản cọc. Vui lòng xác nhận nếu bạn đã nhận được tiền. Sàn không giữ hay chuyển tiền và không bảo đảm khoản này.',
      this.dataOf(saved)
    )
    return saved
  }

  async acknowledgeRefund(
    contractId: string,
    actorId: string,
    refundId: string,
    now = new Date()
  ): Promise<Statement> {
    const statement = await this.findOrFail(contractId)
    if (actorId !== statement.tenantId)
      throw new ForbiddenException('STATEMENT_ACCESS_DENIED')
    const refund = statement.refunds.find(item => item.id === refundId)
    if (!refund) throw new NotFoundException('STATEMENT_REFUND_NOT_FOUND')
    if (refund.tenantAcknowledgedAt) return statement
    refund.tenantAcknowledgedAt = now
    this.audit(
      statement,
      now,
      actorId,
      'tenant',
      'refund-acknowledged',
      refundId
    )
    const confirmed = sum(
      statement.refunds
        .filter(item => item.tenantAcknowledgedAt)
        .map(item => item.amount)
    )
    if (confirmed >= refundableAmount(statement))
      this.close(statement, now, 'tenant-acknowledged')
    const saved = await this.repo.save(statement)
    const id = saved._id.toHexString()
    await this.support.recordEvent({
      contractId,
      eventType: 'deposit-statement.refund-acknowledged',
      actorRole: 'tenant',
      actorId,
      refs: { settlementId: id, status: saved.status },
      transitionKey: `deposit-statement:${id}:refund-ack:${refundId}`,
    })
    await this.support.notify(
      [saved.landlordId],
      'Khách thuê xác nhận đã nhận cọc',
      saved.status === 'closed'
        ? 'Khách thuê đã xác nhận nhận đủ tiền cọc. Bảng khấu trừ đã đóng.'
        : 'Khách thuê đã xác nhận nhận một khoản hoàn cọc.',
      this.dataOf(saved)
    )
    return saved
  }

  /**
   * Tác vụ định kỳ: quá hạn phản hồi → `accepted`; nhắc và ghi sự kiện quá hạn hoàn cọc;
   * khách không xác nhận đã nhận → `closed`. Không có chế tài tự động. Idempotent.
   */
  async processDeadlines(now = new Date()): Promise<number> {
    // ponytail: quét các bảng đang mở rồi lọc trong bộ nhớ; thêm index theo status/hạn nếu cần.
    const rows = await this.repo.find()
    let count = 0
    for (const row of rows) {
      const changed = await this.sweepOne(row, now)
      if (changed) count += 1
    }
    return count
  }

  private async sweepOne(row: Statement, now: Date): Promise<boolean> {
    try {
      if (row.status === 'awaiting-tenant')
        return await this.sweepResponse(row, now)
      if (row.status === 'accepted') return await this.sweepRefundDue(row, now)
      if (row.status === 'refund-recorded')
        return await this.sweepAcknowledge(row, now)
      return false
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(
        `Deposit statement deadline sweep failed for [${row._id.toHexString()}]: ${message}`
      )
      return false
    }
  }

  private async sweepResponse(row: Statement, now: Date): Promise<boolean> {
    if (!row.responseDueAt || new Date(row.responseDueAt) > now) return false
    this.markAccepted(row, now, 'tenant-no-response')
    this.audit(row, now, null, 'system', 'accepted-no-response')
    const saved = await this.repo.save(row)
    await this.support.recordEvent({
      contractId: saved.contractId,
      eventType: 'deposit-statement.accepted-no-response',
      actorRole: 'system',
      refs: { settlementId: saved._id.toHexString() },
      transitionKey: `deposit-statement:${saved._id.toHexString()}:accepted-no-response`,
    })
    await this.support.notify(
      [saved.tenantId, saved.landlordId],
      'Bảng khấu trừ cọc đã được coi là chấp nhận',
      'Khách thuê không phản hồi trong hạn nên bảng khấu trừ được coi là đã chấp nhận. Khách vẫn có thể yêu cầu tranh chấp.',
      this.dataOf(saved)
    )
    return true
  }

  private async sweepRefundDue(row: Statement, now: Date): Promise<boolean> {
    if (!row.refundDueAt || row.refunds.length > 0) return false
    const dueAt = new Date(row.refundDueAt)
    const id = row._id.toHexString()
    if (dueAt <= now) {
      if (row.refundOverdueAt) return false
      row.refundOverdueAt = now
      this.audit(row, now, null, 'system', 'refund-overdue')
      const saved = await this.repo.save(row)
      await this.support.recordEvent({
        contractId: saved.contractId,
        eventType: 'deposit-statement.refund-overdue',
        actorRole: 'system',
        refs: { settlementId: id },
        transitionKey: `deposit-statement:${id}:refund-overdue`,
      })
      await this.support.notify(
        [saved.tenantId, saved.landlordId],
        'Đã quá hạn hoàn cọc',
        'Đã quá hạn hoàn cọc theo hợp đồng nhưng chưa có bản ghi hoàn cọc. Hệ thống chỉ ghi nhận và nhắc, không áp dụng chế tài.',
        this.dataOf(saved)
      )
      return true
    }
    if (
      row.refundReminderSentAt ||
      dueAt.getTime() - now.getTime() > REFUND_REMINDER_LEAD_MS
    )
      return false
    row.refundReminderSentAt = now
    const saved = await this.repo.save(row)
    await this.support.notify(
      [saved.tenantId, saved.landlordId],
      'Sắp đến hạn hoàn cọc',
      'Hạn hoàn cọc theo hợp đồng sẽ đến trong vòng 1 ngày. Chủ nhà vui lòng hoàn cọc và ghi nhận trên hệ thống.',
      this.dataOf(saved)
    )
    return true
  }

  private async sweepAcknowledge(row: Statement, now: Date): Promise<boolean> {
    const last = row.refunds[row.refunds.length - 1]
    if (!last) return false
    if (addDays(new Date(last.recordedAt), row.responseDays) > now) return false
    this.close(row, now, 'tenant-no-acknowledge')
    this.audit(row, now, null, 'system', 'closed-no-acknowledge')
    const saved = await this.repo.save(row)
    await this.support.recordEvent({
      contractId: saved.contractId,
      eventType: 'deposit-statement.closed-no-acknowledge',
      actorRole: 'system',
      refs: { settlementId: saved._id.toHexString() },
      transitionKey: `deposit-statement:${saved._id.toHexString()}:closed-no-acknowledge`,
    })
    await this.support.notify(
      [saved.tenantId, saved.landlordId],
      'Bảng khấu trừ cọc đã đóng',
      'Khách thuê không xác nhận đã nhận tiền trong hạn nên bảng được đóng tự động.',
      this.dataOf(saved)
    )
    return true
  }

  private markAccepted(
    statement: Statement,
    now: Date,
    reason: NonNullable<Statement['acceptedReason']>
  ): void {
    statement.status = 'accepted'
    statement.acceptedAt = now
    statement.acceptedReason = reason
    statement.refundDueAt = addDays(now, DEPOSIT_REFUND_DUE_DAYS)
    if (refundableAmount(statement) <= 0)
      this.close(statement, now, 'no-refund-due')
  }

  private close(
    statement: Statement,
    now: Date,
    reason: NonNullable<Statement['closeReason']>
  ): void {
    statement.status = 'closed'
    statement.closedAt = now
    statement.closeReason = reason
  }

  private buildLines(lines: StatementLineInput[]): DepositStatementLine[] {
    return lines.map(line => ({
      id: randomUUID(),
      reason: line.reason.trim(),
      amount: line.amount,
      evidenceUrls: line.evidenceUrls ?? [],
      tenantResponse: null,
    }))
  }

  private hashOf(statement: Statement): string {
    return sha256Hex({
      contractId: statement.contractId,
      depositAmount: statement.depositAmount,
      lines: statement.lines.map(line => ({
        id: line.id,
        reason: line.reason,
        amount: line.amount,
        evidenceUrls: line.evidenceUrls,
      })),
    })
  }

  /** D8: neo khi chốt bảng; chaincode chỉ nhận hash, không có lý do hay số tiền từng dòng. */
  private async anchorStatement(
    statement: Statement,
    now: Date
  ): Promise<void> {
    if (!this.support.canAnchor || !statement.statementHash) return
    try {
      const id = statement._id.toHexString()
      const occurredAt = now.toISOString()
      const manifestHash = sha256Hex({
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        statementId: id,
        contractId: statement.contractId,
        statementHash: statement.statementHash,
        occurredAt,
      })
      statement.evidence = pendingEvidence(
        EVIDENCE_SCHEMA_VERSION,
        manifestHash
      )
      await this.support.enqueueLedger({
        aggregateType: 'deposit-statement',
        aggregateId: id,
        eventType: 'deposit-statement.submitted',
        action: 'recordMoveInSettlement',
        args: buildMoveInSettlementArgs({
          settlementId: id,
          contractId: statement.contractId,
          manifestHash,
          manifestSchemaVersion: EVIDENCE_SCHEMA_VERSION,
          occurredAt,
        }),
        contractId: statement.contractId,
        payloadHash: manifestHash,
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
      })
    } catch (error) {
      this.logAnchorFailure('statement', error)
    }
  }

  private async anchorRefund(
    statement: Statement,
    refund: DepositRefundRecord,
    now: Date
  ): Promise<void> {
    if (!this.support.canAnchor) return
    try {
      const id = statement._id.toHexString()
      const occurredAt = now.toISOString()
      const manifestHash = sha256Hex({
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        statementId: id,
        refundId: refund.id,
        contractId: statement.contractId,
        amount: refund.amount,
        paidAt: refund.paidAt.toISOString(),
        transactionRefHash: sha256Hex(refund.transactionRef),
        occurredAt,
      })
      refund.evidence = pendingEvidence(EVIDENCE_SCHEMA_VERSION, manifestHash)
      await this.support.enqueueLedger({
        aggregateType: 'deposit-refund',
        aggregateId: id,
        eventType: `deposit-refund.${refund.id}`,
        action: 'recordMoveInSettlement',
        args: buildMoveInSettlementArgs({
          settlementId: `${id}-${refund.id}`,
          contractId: statement.contractId,
          manifestHash,
          manifestSchemaVersion: EVIDENCE_SCHEMA_VERSION,
          occurredAt,
        }),
        contractId: statement.contractId,
        payloadHash: manifestHash,
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
      })
    } catch (error) {
      this.logAnchorFailure('refund', error)
    }
  }

  private logAnchorFailure(kind: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.logger.warn(
      `Ledger evidence for deposit ${kind} was not queued; business state is unaffected: ${message}`
    )
  }

  private audit(
    statement: Statement,
    at: Date,
    actorId: string | null,
    actorRole: DepositStatementAuditEntry['actorRole'],
    action: string,
    detail: string | null = null
  ): void {
    statement.auditLog = [
      ...statement.auditLog,
      { at, actorId, actorRole, action, detail },
    ]
  }

  private async assertHandoverCompleted(contractId: string): Promise<void> {
    const handover = await this.handoverRepo.findOne({ where: { contractId } })
    if (handover?.status !== 'completed')
      throw new ConflictException('MOVE_OUT_HANDOVER_NOT_COMPLETED')
  }

  private async findOrFail(contractId: string): Promise<Statement> {
    const row = await this.repo.findOne({ where: { contractId } })
    if (!row) throw new NotFoundException('STATEMENT_NOT_FOUND')
    return row
  }

  private roleOf(statement: Statement, actorId: string): Role | null {
    if (actorId === statement.tenantId) return 'tenant'
    if (actorId === statement.landlordId) return 'landlord'
    return null
  }

  private dataOf(statement: Statement): Record<string, unknown> {
    return {
      contractId: statement.contractId,
      depositStatementId: statement._id.toHexString(),
      status: statement.status,
    }
  }
}
