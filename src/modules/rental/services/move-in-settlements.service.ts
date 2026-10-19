import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { Contract } from '../../contracts/schemas/contract.schema'
import { Payment } from '../../payments/schemas/payment.schema'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { RentalTransactionEventService } from '../services/rental-transaction-event.service'
import type { RentalTransactionActorRole } from '../schemas/rental-transaction-event.schema'
import {
  MoveInSettlement,
  type HandoverInventoryItem,
  type LedgerEvidenceRef,
  type SettlementLine,
} from '../schemas/move-in-settlement.schema'
import { LedgerOutboxService } from '../../fabric/services/ledger-outbox.service'
import type { LedgerOutbox } from '../../fabric/schemas/ledger-outbox.schema'
import {
  MOVE_IN_SETTLEMENT_EVIDENCE_SCHEMA_VERSION,
  buildMoveInSettlementEvidenceEnvelope,
  hashMoveInSettlementEvidenceEnvelope,
} from '../../fabric/utils/move-in-evidence-envelope'
import {
  type MoveInHandoverEvidenceSchemaVersion,
  buildMoveInHandoverEvidenceEnvelope,
  hashMoveInHandoverEvidenceEnvelope,
} from '../../fabric/utils/move-in-handover-evidence-envelope'
import {
  buildHandoverArgs,
  buildMoveInSettlementArgs,
} from '../../fabric/utils/ledger-action-args'
import type { DepositAgreementsService } from '../../contracts/services/deposit-agreements.service'
import { resolveDepositConfirmation } from '../../contracts/services/deposit-confirmation.resolver'
import { renderMoveInHandoverPdf } from '../utils/move-in-handover-pdf.renderer'

/** Điều 9.1: khách thuê có 3 ngày để xác nhận hoặc báo sai lệch kể từ khi bản sửa đổi được ghi. */
export const HANDOVER_RESPONSE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

const formatViDateTime = (date: Date): string =>
  date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })

type HandoverEvidence = {
  schemaVersion: MoveInHandoverEvidenceSchemaVersion
  manifestHash: string
  completedAt: string
  overrideUsed: boolean
}

@Injectable()
export class MoveInSettlementsService {
  private readonly logger = new Logger(MoveInSettlementsService.name)

  constructor(
    @InjectRepository(MoveInSettlement)
    private readonly settlementRepo: Repository<MoveInSettlement>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly notifications: NotificationsService,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService,
    @Optional()
    private readonly ledgerOutboxService?: LedgerOutboxService,
    // DepositAgreementsService is type-only imported above to break a
    // require() cycle (move-in-settlements -> deposit-agreements ->
    // contracts.service -> move-in-settlements) that otherwise throws
    // "class used before initialization" at boot. forwardRef() defers this
    // require() until Nest resolves the provider, after all three modules
    // have finished loading, so the lazy require is required here.
    @Optional()
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access */
    @Inject(
      forwardRef(
        () =>
          require('../../contracts/services/deposit-agreements.service')
            .DepositAgreementsService
      )
    )
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access */
    private readonly depositAgreementsService?: DepositAgreementsService
  ) {}

  /**
   * PROP-399 D3 (MOVE_IN_SETTLED): gọi đúng một lần khi settlement vừa chuyển sang `paid`
   * và đã được lưu. Lưu `settlementEvidence` rồi mới enqueue; mọi lỗi chỉ được log —
   * giao dịch nghiệp vụ không bao giờ thất bại vì sổ cái (reconciliation sẽ phát hiện).
   */
  async recordSettlementPaidEvidence(
    settlement: MoveInSettlement
  ): Promise<void> {
    if (
      !this.ledgerOutboxService ||
      settlement.status !== 'paid' ||
      settlement.settlementEvidence
    ) {
      return
    }
    const settlementId = settlement._id.toHexString()
    try {
      const { manifestHash, paidAt } = this.buildSettlementEvidence(settlement)
      settlement.settlementEvidence = this.pendingEvidence(
        MOVE_IN_SETTLEMENT_EVIDENCE_SCHEMA_VERSION,
        manifestHash
      )
      await this.settlementRepo.save(settlement)
      await this.enqueueSettlementEvidence(settlement, manifestHash, paidAt)
    } catch (error) {
      this.logLedgerEvidenceFailure('settlement', settlementId, error)
    }
  }

  /**
   * PROP-399 D7 (repair): tạo lại đúng một outbox item MOVE_IN_SETTLED từ trạng thái nghiệp vụ còn
   * hợp lệ. Idempotent theo khoá outbox; trả null khi điều kiện nghiệp vụ không còn (không paid).
   */
  async ensureSettlementEvidenceQueued(
    settlementId: string
  ): Promise<LedgerOutbox | null> {
    if (!this.ledgerOutboxService) return null
    const settlement = await this.findOrNull(settlementId)
    if (!settlement || settlement.status !== 'paid') return null
    const { manifestHash, paidAt } = this.buildSettlementEvidence(settlement)
    if (!settlement.settlementEvidence) {
      settlement.settlementEvidence = this.pendingEvidence(
        MOVE_IN_SETTLEMENT_EVIDENCE_SCHEMA_VERSION,
        manifestHash
      )
      await this.settlementRepo.save(settlement)
    } else if (settlement.settlementEvidence.manifestHash !== manifestHash) {
      throw new ConflictException('SETTLEMENT_EVIDENCE_HASH_CONFLICT')
    }
    return this.enqueueSettlementEvidence(settlement, manifestHash, paidAt)
  }

  private buildSettlementEvidence(settlement: MoveInSettlement): {
    manifestHash: string
    paidAt: string
  } {
    const paidTimes = settlement.lines
      .map(line => (line.paidAt ? new Date(line.paidAt).getTime() : NaN))
      .filter(time => !Number.isNaN(time))
    const paidAt = new Date(
      paidTimes.length > 0 ? Math.max(...paidTimes) : Date.now()
    ).toISOString()
    const envelope = buildMoveInSettlementEvidenceEnvelope({
      settlementId: settlement._id.toHexString(),
      contractId: settlement.contractId,
      statementHash: settlement.statementHash,
      lines: settlement.lines.map(line => ({
        kind: line.kind,
        amount: line.amount,
        paymentId: line.paymentId,
      })),
      total: settlement.total,
      paidAt,
    })
    return {
      manifestHash: hashMoveInSettlementEvidenceEnvelope(envelope),
      paidAt,
    }
  }

  private enqueueSettlementEvidence(
    settlement: MoveInSettlement,
    manifestHash: string,
    paidAt: string
  ): Promise<LedgerOutbox> {
    const settlementId = settlement._id.toHexString()
    return this.ledgerOutboxService!.enqueue({
      aggregateType: 'move-in-settlement',
      aggregateId: settlementId,
      eventType: 'move-in.settled',
      action: 'recordMoveInSettlement',
      args: buildMoveInSettlementArgs({
        settlementId,
        contractId: settlement.contractId,
        manifestHash,
        manifestSchemaVersion: MOVE_IN_SETTLEMENT_EVIDENCE_SCHEMA_VERSION,
        occurredAt: paidAt,
      }),
      dependencyKeys: [`contract:${settlement.contractId}:contract.activated`],
      metadata: {
        contractId: settlement.contractId,
        settlementId,
        schemaVersion: MOVE_IN_SETTLEMENT_EVIDENCE_SCHEMA_VERSION,
        payloadHash: manifestHash,
      },
    })
  }

  /** PROP-399 D3 (HANDOVER_RECORDED): tương tự — chỉ gọi khi `completedAt` vừa được đặt và lưu. */
  private async recordHandoverCompletedEvidence(
    settlement: MoveInSettlement
  ): Promise<void> {
    const handover = settlement.handover
    if (
      !this.ledgerOutboxService ||
      !handover?.completedAt ||
      settlement.handoverEvidence
    ) {
      return
    }
    const settlementId = settlement._id.toHexString()
    try {
      const evidence = this.buildHandoverEvidence(settlement)
      settlement.handoverEvidence = this.pendingEvidence(
        evidence.schemaVersion,
        evidence.manifestHash
      )
      await this.settlementRepo.save(settlement)
      await this.enqueueHandoverEvidence(settlement, evidence)
    } catch (error) {
      this.logLedgerEvidenceFailure('handover', settlementId, error)
    }
  }

  /** PROP-399 D7 (repair): như ensureSettlementEvidenceQueued nhưng cho bàn giao đã hoàn tất. */
  async ensureHandoverEvidenceQueued(
    settlementId: string
  ): Promise<LedgerOutbox | null> {
    if (!this.ledgerOutboxService) return null
    const settlement = await this.findOrNull(settlementId)
    if (!settlement?.handover?.completedAt) return null
    const evidence = this.buildHandoverEvidence(settlement)
    if (!settlement.handoverEvidence) {
      settlement.handoverEvidence = this.pendingEvidence(
        evidence.schemaVersion,
        evidence.manifestHash
      )
      await this.settlementRepo.save(settlement)
    } else if (
      settlement.handoverEvidence.manifestHash !== evidence.manifestHash
    ) {
      throw new ConflictException('HANDOVER_EVIDENCE_HASH_CONFLICT')
    }
    return this.enqueueHandoverEvidence(settlement, evidence)
  }

  private buildHandoverEvidence(
    settlement: MoveInSettlement
  ): HandoverEvidence {
    const handover = settlement.handover!
    const completedAt = new Date(handover.completedAt!).toISOString()
    const overrideUsed = Boolean(handover.overrideReason?.trim())
    const envelope = buildMoveInHandoverEvidenceEnvelope({
      settlementId: settlement._id.toHexString(),
      contractId: settlement.contractId,
      revision: handover.revision,
      handoverHash: handover.handoverHash,
      tenantConfirmationHash: handover.tenantConfirmation?.hash ?? '',
      landlordConfirmationHash: handover.landlordConfirmation?.hash ?? '',
      completedAt,
      overrideUsed,
      completionReason: handover.completionReason ?? null,
    })
    return {
      schemaVersion: envelope.schemaVersion,
      manifestHash: hashMoveInHandoverEvidenceEnvelope(envelope),
      completedAt,
      overrideUsed,
    }
  }

  private enqueueHandoverEvidence(
    settlement: MoveInSettlement,
    { schemaVersion, manifestHash, completedAt, overrideUsed }: HandoverEvidence
  ): Promise<LedgerOutbox> {
    const settlementId = settlement._id.toHexString()
    const handover = settlement.handover!
    return this.ledgerOutboxService!.enqueue({
      aggregateType: 'move-in-handover',
      aggregateId: settlementId,
      eventType: 'handover.completed',
      action: 'recordHandover',
      args: buildHandoverArgs({
        settlementId,
        contractId: settlement.contractId,
        handoverHash: handover.handoverHash,
        manifestSchemaVersion: schemaVersion,
        revision: handover.revision,
        overrideUsed,
        occurredAt: completedAt,
      }),
      dependencyKeys: [`contract:${settlement.contractId}:contract.activated`],
      metadata: {
        contractId: settlement.contractId,
        settlementId,
        handoverRevision: handover.revision,
        schemaVersion,
        payloadHash: manifestHash,
      },
    })
  }

  private async findOrNull(id: string): Promise<MoveInSettlement | null> {
    if (!ObjectId.isValid(id)) return null
    return this.settlementRepo.findOne({ where: { _id: new ObjectId(id) } })
  }

  private pendingEvidence(
    manifestVersion: number,
    manifestHash: string
  ): LedgerEvidenceRef {
    return {
      manifestVersion,
      manifestHash,
      ledgerStatus: 'pending',
      txHash: null,
      blockNumber: null,
      recordedAt: new Date(),
    }
  }

  private logLedgerEvidenceFailure(
    kind: 'settlement' | 'handover',
    settlementId: string,
    error: unknown
  ): void {
    const message = error instanceof Error ? error.message : String(error)
    this.logger.warn(
      `Ledger evidence for ${kind} [${settlementId}] was not queued; business state is unaffected and reconciliation will recover it: ${message}`
    )
  }

  private async recordTransactionEvent(input: {
    contractId: string
    eventType: string
    actorRole: RentalTransactionActorRole
    actorId?: string | null
    refs?: Record<string, string>
    transitionKey: string
  }): Promise<void> {
    if (!this.transactionEventService) return
    try {
      await this.transactionEventService.record({
        transactionKey: input.contractId,
        contractId: input.contractId,
        eventType: input.eventType,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        refs: { contractId: input.contractId, ...(input.refs ?? {}) },
        transitionKey: input.transitionKey,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Rental transaction audit failed for settlement event [${input.eventType}] on contract [${input.contractId}]: ${message}`
      )
    }
  }

  async createForContract(
    contract: Contract,
    activatedAt = new Date()
  ): Promise<MoveInSettlement | null> {
    const contractId = contract._id.toHexString()
    const existing = await this.settlementRepo.findOne({
      where: { contractId },
    })
    if (existing) return existing
    const policy = contract.packageSnapshot?.settlementPolicy
    const tenantFee = contract.feeSnapshot?.quote?.find(
      line => line.payerRole === 'tenant'
    )
    const payments = await this.paymentRepo.find({
      where: { contractId, type: 'rent' },
    })
    const firstRent = payments.sort((a, b) =>
      (a.periodKey ?? '').localeCompare(b.periodKey ?? '')
    )[0]
    const dueAt = new Date(contract.startDate)
    dueAt.setDate(dueAt.getDate() - (policy?.firstPaymentDueOffsetDays ?? 3))
    const minimumDue = new Date(activatedAt)
    minimumDue.setDate(minimumDue.getDate() + 1)
    if (dueAt < minimumDue) dueAt.setTime(minimumDue.getTime())
    const lines: SettlementLine[] = []
    const holding =
      contract.packageSnapshot?.resolvedHoldingDepositAmount ?? contract.deposit
    const topUp = Math.max(0, contract.deposit - holding)
    if (topUp > 0) {
      const topUpPayment = await this.createSettlementPayment({
        contract,
        contractId,
        amount: topUp,
        dueAt,
        type: 'deposit-topup',
        periodKey: 'SETTLEMENT:DEPOSIT_TOPUP',
        description: 'Move-in security deposit top-up',
      })
      lines.push({
        kind: 'DEPOSIT_TOPUP',
        amount: topUp,
        paymentId: topUpPayment._id.toHexString(),
      })
    }
    // gói "chỉ đặt cọc": tiền thuê kỳ đầu không thu khi nhận nhà mà theo lịch thanh toán thường
    const collectFirstRentAtMoveIn = contract.prepaidRentMonths !== 0
    if (firstRent && collectFirstRentAtMoveIn)
      lines.push({
        kind: 'FIRST_RENT',
        amount: firstRent.amount,
        paymentId: firstRent._id.toHexString(),
      })
    if (tenantFee && tenantFee.amount > 0) {
      const existingFeeInvoice = await this.paymentRepo.findOne({
        where: { contractId, type: 'platform-fee', feeKind: 'TENANT_SERVICE' },
      })
      const feeInvoice =
        existingFeeInvoice ??
        (await this.createSettlementPayment({
          contract,
          contractId,
          amount: tenantFee.amount,
          dueAt,
          type: 'platform-fee',
          periodKey: 'SETTLEMENT:TENANT_SERVICE',
          description: 'Tenant move-in service fee',
          feeKind: 'TENANT_SERVICE',
          payeeRole: 'platform',
        }))
      lines.push({
        kind: 'TENANT_SERVICE_FEE',
        amount: tenantFee.amount,
        paymentId: feeInvoice._id.toHexString(),
      })
    }
    if (!lines.length) return null
    const total = lines.reduce((sum, line) => sum + line.amount, 0)
    const canonical = JSON.stringify({
      contractId,
      lines,
      total,
      dueAt: dueAt.toISOString(),
    })
    const settlement = this.settlementRepo.create({
      contractId,
      tenantId: contract.tenantId,
      landlordId: contract.landlordId,
      lines,
      total,
      dueAt,
      status: 'pending',
      statementHash: createHash('sha256').update(canonical).digest('hex'),
      handover: null,
    })
    const saved = await this.settlementRepo.save(settlement)
    contract.settlementId = saved._id.toHexString()
    await this.contractRepo.save(contract)
    await this.recordTransactionEvent({
      contractId,
      eventType: 'settlement.created',
      actorRole: 'system',
      refs: { settlementId: saved._id.toHexString() },
      transitionKey: `settlement:${saved._id.toHexString()}:created`,
    })
    return saved
  }

  async updateHandover(
    id: string,
    actorId: string,
    input: {
      handedOverAt: string
      electricity: number
      water: number
      keyCount: number
      inventoryItems?: Array<{
        name: string
        quantity: number
        condition: 'good' | 'damaged'
        note?: string
      }>
      inventoryReference?: string
      notes?: string
      overrideReason?: string
      isStaff?: boolean
    },
    now = new Date()
  ): Promise<MoveInSettlement> {
    const settlement = await this.find(id)
    const isLandlord = actorId === settlement.landlordId
    if (!isLandlord && !input.isStaff)
      throw new ForbiddenException('HANDOVER_ACCESS_DENIED')
    if (settlement.handover?.completedAt)
      throw new ConflictException('HANDOVER_COMPLETED_IMMUTABLE')
    if (
      settlement.status !== 'paid' &&
      !(await this.isDepositConfirmedForContract(settlement.contractId)) &&
      !(input.isStaff && input.overrideReason?.trim())
    )
      throw new ConflictException('HANDOVER_REQUIRES_SETTLEMENT')
    const revision = (settlement.handover?.revision ?? 0) + 1
    const inventoryItems: HandoverInventoryItem[] = (
      input.inventoryItems ?? []
    ).map(item => ({
      name: item.name,
      quantity: item.quantity,
      condition: item.condition,
      note: item.note?.trim() || null,
    }))
    const body = {
      revision,
      handedOverAt: new Date(input.handedOverAt).toISOString(),
      electricity: input.electricity,
      water: input.water,
      keyCount: input.keyCount,
      inventoryReference: input.inventoryReference ?? null,
      inventoryItems,
      notes: input.notes ?? null,
    }
    const handoverHash = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex')
    const responseDueAt = new Date(now.getTime() + HANDOVER_RESPONSE_WINDOW_MS)
    settlement.handover = {
      revision,
      handedOverAt: new Date(input.handedOverAt),
      meterReadings: { electricity: input.electricity, water: input.water },
      keyCount: input.keyCount,
      inventoryReference: input.inventoryReference ?? null,
      inventoryItems,
      // Phản hồi của các bản trước được giữ lại, không ghi đè.
      discrepancies: settlement.handover?.discrepancies ?? [],
      responseDueAt,
      completionReason: null,
      notes: input.notes ?? null,
      handoverHash,
      recordedBy: actorId,
      tenantConfirmation: null,
      // Chủ nhà lập biên bản = đã xác nhận bản này; nhân viên lập thì chủ nhà vẫn phải xác nhận.
      landlordConfirmation: isLandlord ? { at: now, hash: handoverHash } : null,
      discrepancyNote: null,
      overrideReason: input.overrideReason ?? null,
      completedAt: null,
    }
    const saved = await this.settlementRepo.save(settlement)
    await this.recordTransactionEvent({
      contractId: saved.contractId,
      eventType: 'settlement.handover-recorded',
      actorRole: isLandlord ? 'landlord' : 'staff',
      actorId,
      refs: { settlementId: saved._id.toHexString() },
      transitionKey: `settlement:${saved._id.toHexString()}:handover-recorded:${revision}`,
    })
    await this.notifyHandover(
      [saved.tenantId],
      'Biên bản bàn giao cần bạn xác nhận',
      `Chủ nhà đã ghi biên bản bàn giao căn hộ. Vui lòng xem và xác nhận hoặc báo sai lệch trước ${formatViDateTime(responseDueAt)}; quá hạn biên bản sẽ tự hoàn tất theo Điều 9.1.`,
      saved
    )
    return saved
  }

  async confirmHandover(
    id: string,
    actorId: string,
    role: 'tenant' | 'landlord',
    handoverHash: string
  ): Promise<MoveInSettlement> {
    const settlement = await this.find(id)
    const handover = settlement.handover
    if (!handover) throw new ConflictException('HANDOVER_NOT_RECORDED')
    if (handover.completedAt) return settlement
    if (
      (role === 'tenant' && settlement.tenantId !== actorId) ||
      (role === 'landlord' && settlement.landlordId !== actorId)
    )
      throw new ForbiddenException('HANDOVER_ACCESS_DENIED')
    if (handover.handoverHash !== handoverHash)
      throw new ConflictException('HANDOVER_REVISION_STALE')
    if (role === 'tenant' && this.hasOpenDiscrepancy(handover))
      throw new ConflictException('HANDOVER_DISCREPANCY_OPEN')
    if (role === 'tenant')
      handover.tenantConfirmation = { at: new Date(), hash: handoverHash }
    else handover.landlordConfirmation = { at: new Date(), hash: handoverHash }
    const justCompleted =
      handover.tenantConfirmation?.hash === handoverHash &&
      handover.landlordConfirmation?.hash === handoverHash
    if (justCompleted) {
      handover.completedAt = new Date()
      handover.completionReason = 'both-confirmed'
    }
    const saved = await this.settlementRepo.save(settlement)
    if (justCompleted) await this.afterHandoverCompleted(saved, role, actorId)
    return saved
  }

  /**
   * Khách thuê báo sai lệch cho bản hiện tại. Không phải xác nhận và không làm hoàn tất;
   * chủ nhà sửa biên bản (bản mới) để khách thuê xác nhận lại.
   */
  async reportHandoverDiscrepancy(
    id: string,
    actorId: string,
    handoverHash: string,
    note: string
  ): Promise<MoveInSettlement> {
    const settlement = await this.find(id)
    const handover = settlement.handover
    if (!handover) throw new ConflictException('HANDOVER_NOT_RECORDED')
    if (settlement.tenantId !== actorId)
      throw new ForbiddenException('HANDOVER_ACCESS_DENIED')
    if (handover.completedAt)
      throw new ConflictException('HANDOVER_COMPLETED_IMMUTABLE')
    if (handover.handoverHash !== handoverHash)
      throw new ConflictException('HANDOVER_REVISION_STALE')
    if (handover.tenantConfirmation?.hash === handoverHash)
      throw new ConflictException('HANDOVER_ALREADY_CONFIRMED')
    const discrepancies = [
      ...(handover.discrepancies ?? []),
      { revision: handover.revision, note: note.trim(), at: new Date() },
    ]
    handover.discrepancies = discrepancies
    const saved = await this.settlementRepo.save(settlement)
    await this.recordTransactionEvent({
      contractId: saved.contractId,
      eventType: 'settlement.handover-discrepancy-reported',
      actorRole: 'tenant',
      actorId,
      refs: { settlementId: saved._id.toHexString() },
      transitionKey: `settlement:${saved._id.toHexString()}:handover-discrepancy:${handover.revision}:${discrepancies.length}`,
    })
    await this.notifyHandover(
      [saved.landlordId],
      'Khách thuê báo sai lệch biên bản bàn giao',
      'Khách thuê đã gửi phản hồi sai lệch cho biên bản bàn giao. Vui lòng xem phản hồi và sửa biên bản để khách thuê xác nhận lại.',
      saved
    )
    return saved
  }

  /**
   * Điều 9.1: biên bản đã có xác nhận của chủ nhà, khách thuê không xác nhận và không báo
   * sai lệch cho bản hiện tại đến hết `responseDueAt` → hoàn tất `tenant-no-response`.
   * Idempotent: bản đã hoàn tất bị bỏ qua.
   */
  async processHandoverResponseDeadlines(now = new Date()): Promise<number> {
    // ponytail: quét toàn bộ rồi lọc trong bộ nhớ như processOverdue (mỗi hợp đồng một bản ghi);
    // chuyển sang truy vấn `handover.responseDueAt` có index nếu số hợp đồng lớn.
    const rows = await this.settlementRepo.find()
    let count = 0
    for (const row of rows) {
      const handover = row.handover
      if (!handover || !this.isHandoverResponseExpired(handover, now)) continue
      handover.completedAt = now
      handover.completionReason = 'tenant-no-response'
      const saved = await this.settlementRepo.save(row)
      await this.afterHandoverCompleted(saved, 'system', null)
      count += 1
    }
    return count
  }

  private isHandoverResponseExpired(
    handover: NonNullable<MoveInSettlement['handover']>,
    now: Date
  ): boolean {
    if (handover.completedAt || !handover.responseDueAt) return false
    return (
      new Date(handover.responseDueAt) <= now &&
      handover.landlordConfirmation?.hash === handover.handoverHash &&
      handover.tenantConfirmation?.hash !== handover.handoverHash &&
      !this.hasOpenDiscrepancy(handover)
    )
  }

  private hasOpenDiscrepancy(
    handover: NonNullable<MoveInSettlement['handover']>
  ): boolean {
    return (handover.discrepancies ?? []).some(
      item => item.revision === handover.revision
    )
  }

  private async afterHandoverCompleted(
    saved: MoveInSettlement,
    actorRole: RentalTransactionActorRole,
    actorId: string | null
  ): Promise<void> {
    const settlementId = saved._id.toHexString()
    const completionReason =
      saved.handover?.completionReason ?? 'both-confirmed'
    await this.recordTransactionEvent({
      contractId: saved.contractId,
      eventType: 'settlement.handover-completed',
      actorRole,
      actorId,
      refs: { settlementId, completionReason },
      transitionKey: `settlement:${settlementId}:handover-completed`,
    })
    await this.recordHandoverCompletedEvidence(saved)
    await this.notifyHandover(
      [saved.tenantId, saved.landlordId],
      'Biên bản bàn giao đã hoàn tất',
      completionReason === 'tenant-no-response'
        ? 'Biên bản bàn giao đã hoàn tất: khách thuê không phản hồi sai lệch trong hạn 3 ngày theo Điều 9.1.'
        : 'Biên bản bàn giao đã hoàn tất: hai bên đã xác nhận.',
      saved
    )
  }

  /**
   * Chủ nhà được lập biên bản bàn giao ngay khi cọc đã xác nhận (ký hợp
   * đồng + chuyển cọc), không cần đợi quyết toán nhận nhà (tiền thuê kỳ
   * đầu) trả xong — dùng chung nguồn sự thật `resolveDepositConfirmation`
   * với luồng kích hoạt/ký hợp đồng.
   */
  private async isDepositConfirmedForContract(
    contractId: string
  ): Promise<boolean> {
    if (!this.depositAgreementsService || !ObjectId.isValid(contractId))
      return false
    const [contract, agreement] = await Promise.all([
      this.contractRepo.findOne({ where: { _id: new ObjectId(contractId) } }),
      this.depositAgreementsService.findByContractId(contractId),
    ])
    if (!contract) return false
    return resolveDepositConfirmation(
      {
        deposit: contract.deposit,
        depositPaidAt: contract.depositPaidAt ?? null,
      },
      agreement
        ? {
            id: agreement._id.toHexString(),
            status: agreement.status,
            amount: agreement.amount,
            paidAt: agreement.paidAt,
          }
        : null
    ).confirmed
  }

  /** Lỗi gửi thông báo không làm thất bại thao tác bàn giao. */
  private async notifyHandover(
    userIds: string[],
    title: string,
    body: string,
    settlement: MoveInSettlement
  ): Promise<void> {
    for (const userId of userIds) {
      try {
        await this.notifications.createNotification(
          userId,
          title,
          body,
          'MOVE_IN_HANDOVER',
          {
            contractId: settlement.contractId,
            settlementId: settlement._id.toHexString(),
            revision: settlement.handover?.revision ?? null,
          }
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn(
          `Handover notification for user [${userId}] on contract [${settlement.contractId}] failed: ${message}`
        )
      }
    }
  }

  async processOverdue(now = new Date()): Promise<number> {
    const rows = await this.settlementRepo.find({
      where: { status: 'pending' },
    })
    let count = 0
    for (const row of rows) {
      if (row.dueAt >= now || row.overdueNotifiedAt) continue
      row.status = 'overdue'
      row.overdueNotifiedAt = now
      await this.settlementRepo.save(row)
      await Promise.all(
        [row.tenantId, row.landlordId].map(id =>
          this.notifications.createNotification(
            id,
            'Move-in settlement overdue',
            `Settlement ${row.contractId} is overdue.`,
            'PAYMENT_REMINDER',
            { contractId: row.contractId }
          )
        )
      )
      count += 1
    }
    return count
  }

  private async createSettlementPayment(input: {
    contract: Contract
    contractId: string
    amount: number
    dueAt: Date
    type: 'deposit-topup' | 'platform-fee'
    periodKey: string
    description: string
    feeKind?: 'TENANT_SERVICE'
    payeeRole?: 'landlord' | 'platform'
  }): Promise<Payment> {
    const payment = this.paymentRepo.create({
      contractId: input.contractId,
      tenantId: input.contract.tenantId,
      landlordId: input.contract.landlordId,
      payerId: input.contract.tenantId,
      payerRole: 'tenant',
      payeeRole: input.payeeRole ?? 'landlord',
      amount: input.amount,
      amountBeforeVat: input.amount,
      vatAmount: 0,
      description: input.description,
      dueDate: input.dueAt,
      paidAt: null,
      status: 'unpaid',
      txHash: null,
      type: input.type,
      feeKind: input.feeKind ?? null,
      periodKey: input.periodKey,
      ledgerStatus: 'not-required',
    })
    return this.paymentRepo.save(payment)
  }

  /**
   * PDF một trang của biên bản bàn giao đã hoàn tất, cho khách thuê/chủ nhà
   * của hợp đồng đó hoặc nhân viên/admin.
   */
  async getHandoverPdf(
    id: string,
    actorId: string,
    isStaff: boolean
  ): Promise<{ buffer: Buffer; contractCode: string }> {
    const settlement = await this.find(id)
    const isParty =
      actorId === settlement.tenantId || actorId === settlement.landlordId
    if (!isParty && !isStaff)
      throw new ForbiddenException('HANDOVER_ACCESS_DENIED')
    if (!settlement.handover?.completedAt)
      throw new ConflictException('HANDOVER_NOT_COMPLETED')
    if (!ObjectId.isValid(settlement.contractId))
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    const contract = await this.contractRepo.findOne({
      where: { _id: new ObjectId(settlement.contractId) },
    })
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')
    const buffer = await renderMoveInHandoverPdf(contract, settlement)
    return { buffer, contractCode: contract.contractCode }
  }

  private async find(id: string): Promise<MoveInSettlement> {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('MOVE_IN_SETTLEMENT_NOT_FOUND')
    const row = await this.settlementRepo.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!row) throw new NotFoundException('MOVE_IN_SETTLEMENT_NOT_FOUND')
    return row
  }
}
