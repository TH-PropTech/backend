import { ConflictException, Injectable, Logger, Optional } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import {
  DepositAgreement,
  type DepositAgreementStatus,
  type DepositEscrowSettlement,
} from '../schemas/deposit-agreement.schema'
import {
  MocbankEscrowAlreadySettledError,
  MocbankEscrowClient,
  type MocbankEscrow,
} from '../../wallets/services/mocbank-escrow.client'
import { LedgerOutboxService } from '../../fabric/services/ledger-outbox.service'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { RentalTransactionEventService } from '../../rental/services/rental-transaction-event.service'

export type DepositEscrowSettlementKind = 'release' | 'refund'

const AGREEMENT_STATUS_FOR_KIND: Record<
  DepositEscrowSettlementKind,
  DepositAgreementStatus
> = {
  release: 'released',
  refund: 'refunded',
}

const LEDGER_EVENT_FOR_KIND: Record<DepositEscrowSettlementKind, string> = {
  release: 'deposit.released',
  refund: 'deposit.refunded',
}

/**
 * Vòng đời tất toán ký quỹ cọc tại Ví Mộc (D6/D7). Mọi caller (bàn giao,
 * hủy/hết hạn, chấm dứt hợp đồng, job retry, webhook) đi qua
 * `requestSettlement`/`applyEscrowState` để lệnh gửi Ví Mộc luôn idempotent
 * và không bao giờ ném lỗi ra ngược làm hỏng luồng gọi.
 */
@Injectable()
export class DepositEscrowService {
  private readonly logger = new Logger(DepositEscrowService.name)

  constructor(
    @InjectRepository(DepositAgreement)
    private readonly repository: Repository<DepositAgreement>,
    private readonly escrowClient: MocbankEscrowClient,
    @Optional() private readonly ledgerOutboxService?: LedgerOutboxService,
    @Optional() private readonly notificationsService?: NotificationsService,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService
  ) {}

  /**
   * Yêu cầu Ví Mộc giải ngân (`release`) hoặc hoàn (`refund`) toàn bộ ký quỹ
   * của một thỏa thuận cọc. Không bao giờ ném lỗi: lỗi mạng/5xx được ghi vào
   * `escrow.settlement.state = 'failed'` để job retry xử lý sau.
   */
  async requestSettlement(
    agreementId: string,
    kind: DepositEscrowSettlementKind
  ): Promise<DepositAgreement | null> {
    const agreement = await this.findById(agreementId)
    if (!agreement?.escrow) return agreement
    if (agreement.escrow.settlement) {
      // Đã có settlement (đang chạy, đã xong, hoặc lỗi): không tạo CAS mới.
      // Settlement đang `failed` được job retry nhặt lại qua `retrySettlement`.
      return agreement
    }
    const settlementId = `deposit:${agreement._id.toHexString()}:${kind}`
    const requested: DepositEscrowSettlement = {
      settlementId,
      kind,
      state: 'requested',
      attempts: 0,
      lastError: null,
      transactionCodes: [],
      requestedAt: new Date(),
      settledAt: null,
    }
    const locked = await this.repository.update(
      {
        _id: agreement._id,
        'escrow.settlement': null,
      } as never,
      { escrow: { ...agreement.escrow, settlement: requested } }
    )
    if (!locked.affected) {
      // Trigger khác thắng race; đọc lại trạng thái hiện tại.
      return this.findById(agreementId)
    }
    agreement.escrow = { ...agreement.escrow, settlement: requested }
    return this.runSettlement(agreement, requested)
  }

  /**
   * Nhặt lại các settlement `failed` hoặc kẹt ở `requested` quá
   * `stuckAfterMs` (job hằng giờ, D6). `maxAttempts` chặn retry vô hạn.
   */
  async retryStuckSettlements(
    stuckAfterMs: number,
    maxAttempts = 10,
    now = new Date()
  ): Promise<{ retried: number; stuck: number }> {
    const candidates = await this.repository.find({
      where: [
        { 'escrow.settlement.state': 'failed' },
        { 'escrow.settlement.state': 'requested' },
      ] as never,
    })
    let retried = 0
    let stuck = 0
    for (const agreement of candidates) {
      const settlement = agreement.escrow?.settlement
      if (!settlement || settlement.state === 'settled') continue
      if (
        settlement.state === 'requested' &&
        now.getTime() - settlement.requestedAt.getTime() < stuckAfterMs
      ) {
        continue
      }
      if (settlement.attempts >= maxAttempts) {
        await this.markStuck(agreement)
        stuck += 1
        continue
      }
      await this.runSettlement(agreement, settlement)
      retried += 1
    }
    return { retried, stuck }
  }

  /** `POST /escrow/retry-settlement` của staff: chỉ cho settlement `failed`. */
  async retryManually(agreementId: string): Promise<DepositAgreement> {
    const agreement = await this.findById(agreementId)
    const settlement = agreement?.escrow?.settlement
    if (!agreement?.escrow || !settlement || settlement.state !== 'failed') {
      throw new ConflictException('DEPOSIT_ESCROW_SETTLEMENT_NOT_RETRYABLE')
    }
    const result = await this.runSettlement(agreement, settlement)
    return result ?? agreement
  }

  /**
   * Áp kết quả `escrow.settled` (từ `settle()` hoặc webhook `escrow.settled`)
   * vào thỏa thuận. Idempotent: bỏ qua nếu settlement đã `settled`.
   */
  private async applySettled(
    agreement: DepositAgreement,
    settlement: DepositEscrowSettlement,
    escrow: MocbankEscrow
  ): Promise<DepositAgreement> {
    if (settlement.state === 'settled') return agreement
    const settledAt = new Date()
    const updatedSettlement: DepositEscrowSettlement = {
      ...settlement,
      state: 'settled',
      transactionCodes: escrow.transactionCodes,
      settledAt,
      lastError: null,
    }
    const updatedEscrow = {
      ...agreement.escrow!,
      status: escrow.status,
      settlement: updatedSettlement,
    }
    agreement.escrow = updatedEscrow
    agreement.status = AGREEMENT_STATUS_FOR_KIND[settlement.kind]
    const saved = await this.repository.save(agreement)
    await this.enqueueLedgerEvent(saved, updatedSettlement)
    await this.notifySettled(saved, settlement.kind)
    await this.recordTransactionEvent(
      saved,
      settlement.kind === 'release'
        ? 'deposit.escrow-released'
        : 'deposit.escrow-refunded',
      `deposit:${saved._id.toHexString()}:escrow:${settlement.kind}:settled`
    )
    return saved
  }

  /** Áp webhook `escrow.settled`: xác nhận thứ hai, idempotent với kết quả `settle()` đã áp. */
  async applyWebhookSettled(
    escrowId: string,
    escrow: MocbankEscrow
  ): Promise<DepositAgreement | null> {
    const agreement = await this.repository.findOne({
      where: { 'escrow.escrowId': escrowId } as never,
    })
    const settlement = agreement?.escrow?.settlement
    if (!agreement?.escrow || !settlement) return agreement ?? null
    return this.applySettled(agreement, settlement, escrow)
  }

  /** Áp webhook `escrow.auto_refunded`: Ví Mộc tự hoàn khi quá `autoRefundAt`. */
  async applyAutoRefunded(
    escrowId: string,
    escrow: MocbankEscrow
  ): Promise<DepositAgreement | null> {
    const agreement = await this.repository.findOne({
      where: { 'escrow.escrowId': escrowId } as never,
    })
    if (!agreement?.escrow) return null
    if (agreement.status === 'refunded' || agreement.status === 'released') {
      return agreement
    }
    const settlement: DepositEscrowSettlement = agreement.escrow.settlement ?? {
      settlementId: `deposit:${agreement._id.toHexString()}:refund`,
      kind: 'refund',
      state: 'requested',
      attempts: 0,
      lastError: null,
      transactionCodes: [],
      requestedAt: new Date(),
      settledAt: null,
    }
    const saved = await this.applySettled(agreement, settlement, {
      ...escrow,
      status: 'AUTO_REFUNDED',
    })
    if (saved.linkedLeaseContractId) {
      // Bất thường (D8 lẽ ra đã chặn qua extend): hợp đồng vẫn active mà ký quỹ đã tự hoàn.
      await this.recordTransactionEvent(
        saved,
        'deposit.auto-refunded-on-active-lease',
        `deposit:${saved._id.toHexString()}:escrow:auto-refund-anomaly`
      )
    }
    return saved
  }

  /** Cập nhật `escrow.status`/`heldAt` từ `payment.success`/`escrow.held`; không đổi settlement. */
  async markHeld(agreementId: string, escrow: MocbankEscrow): Promise<void> {
    const agreement = await this.findById(agreementId)
    if (!agreement?.escrow || agreement.escrow.heldAt) return
    agreement.escrow = {
      ...agreement.escrow,
      status: escrow.status,
      heldAt: new Date(),
    }
    await this.repository.save(agreement)
  }

  /** Cập nhật bản sao `escrow.status` từ `payment.cancelled`/`payment.expired`. */
  async syncStatus(
    agreementId: string,
    status: MocbankEscrow['status']
  ): Promise<void> {
    const agreement = await this.findById(agreementId)
    if (!agreement?.escrow || agreement.escrow.status === status) return
    agreement.escrow = { ...agreement.escrow, status }
    await this.repository.save(agreement)
  }

  private async runSettlement(
    agreement: DepositAgreement,
    settlement: DepositEscrowSettlement
  ): Promise<DepositAgreement> {
    const escrow = agreement.escrow
    if (!escrow) return agreement
    const amount = this.allocationAmount(agreement)
    try {
      const result = await this.escrowClient.settle(escrow.escrowId, {
        settlementId: settlement.settlementId,
        reason:
          settlement.kind === 'release'
            ? 'handover-completed'
            : 'deposit-refund',
        allocations: [
          {
            party: settlement.kind === 'release' ? 'PAYEE' : 'PAYER',
            amount,
          },
        ],
      })
      return this.applySettled(agreement, settlement, result)
    } catch (error) {
      if (error instanceof MocbankEscrowAlreadySettledError) {
        const real = await this.escrowClient.get(escrow.escrowId)
        return this.applySettled(agreement, settlement, real)
      }
      return this.markFailed(agreement, settlement, error)
    }
  }

  private allocationAmount(agreement: DepositAgreement): number {
    return agreement.amount
  }

  private async markFailed(
    agreement: DepositAgreement,
    settlement: DepositEscrowSettlement,
    error: unknown
  ): Promise<DepositAgreement> {
    const message = error instanceof Error ? error.message : String(error)
    const updated: DepositEscrowSettlement = {
      ...settlement,
      state: 'failed',
      attempts: settlement.attempts + 1,
      lastError: message.slice(0, 500),
    }
    agreement.escrow = { ...agreement.escrow!, settlement: updated }
    const saved = await this.repository.save(agreement)
    this.logger.warn(
      `Ví Mộc escrow settle failed agreement=${agreement._id.toHexString()} kind=${settlement.kind} attempts=${updated.attempts}: ${message}`
    )
    return saved
  }

  private async markStuck(agreement: DepositAgreement): Promise<void> {
    await this.recordTransactionEvent(
      agreement,
      'deposit.settlement-stuck',
      `deposit:${agreement._id.toHexString()}:escrow:settlement-stuck`
    )
  }

  private async enqueueLedgerEvent(
    agreement: DepositAgreement,
    settlement: DepositEscrowSettlement
  ): Promise<void> {
    if (!this.ledgerOutboxService) return
    try {
      await this.ledgerOutboxService.enqueue({
        aggregateType: 'deposit',
        aggregateId: agreement._id.toHexString(),
        eventType: LEDGER_EVENT_FOR_KIND[settlement.kind],
        action: 'recordDepositSettlement',
        args: [
          agreement._id.toHexString(),
          settlement.kind,
          settlement.settlementId,
          settlement.transactionCodes.join(','),
        ],
        dependencyKey: `deposit:${agreement._id.toHexString()}:deposit.paid`,
        metadata: {
          details: {
            agreementId: agreement._id.toHexString(),
            kind: settlement.kind,
            settlementId: settlement.settlementId,
            transactionCodes: settlement.transactionCodes,
          },
          // Chaincode chưa có action `recordDepositSettlement`; outbox giữ
          // sự kiện cho đến khi nâng cấp (D10, Open Question "Chaincode").
          minimumAbiVersion: 'recordDepositSettlement',
        },
      })
    } catch (error) {
      this.logger.warn(
        `Ledger outbox enqueue failed for deposit settlement ${agreement._id.toHexString()}: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  private async notifySettled(
    agreement: DepositAgreement,
    kind: DepositEscrowSettlementKind
  ): Promise<void> {
    if (!this.notificationsService) return
    const recipients =
      kind === 'release' ? [agreement.landlordId] : [agreement.tenantId]
    const title =
      kind === 'release' ? 'Đã chuyển cọc cho chủ nhà' : 'Đã hoàn cọc'
    const body =
      kind === 'release'
        ? 'Ký quỹ cọc đã được chuyển cho chủ nhà sau khi bàn giao nhà.'
        : 'Ký quỹ cọc đã được hoàn lại cho bạn.'
    for (const userId of recipients) {
      try {
        await this.notificationsService.createNotification(
          userId,
          title,
          body,
          'deposit-escrow',
          { agreementId: agreement._id.toHexString(), kind }
        )
      } catch (error) {
        this.logger.warn(
          `Notification failed for deposit escrow ${agreement._id.toHexString()}: ${error instanceof Error ? error.message : 'unknown'}`
        )
      }
    }
  }

  private async recordTransactionEvent(
    agreement: DepositAgreement,
    eventType: string,
    transitionKey: string
  ): Promise<void> {
    if (!this.transactionEventService) return
    try {
      await this.transactionEventService.record({
        transactionKey:
          agreement.linkedLeaseContractId ?? agreement._id.toHexString(),
        contractId: agreement.linkedLeaseContractId ?? null,
        eventType,
        actorRole: 'system',
        refs: { agreementId: agreement._id.toHexString() },
        transitionKey,
      })
    } catch (error) {
      this.logger.warn(
        `Rental transaction audit failed for deposit escrow [${eventType}]: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  private async findById(id: string): Promise<DepositAgreement | null> {
    if (!ObjectId.isValid(id)) return null
    return this.repository.findOne({ where: { _id: new ObjectId(id) } })
  }
}
