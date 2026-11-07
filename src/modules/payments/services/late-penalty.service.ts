import { Injectable, Logger, Optional } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import type { FindOptionsWhere, Repository } from 'typeorm'
import { Contract } from '../../contracts/schemas/contract.schema'
import { resolveLatePenaltyRate } from '../../contracts/commercial/resolve-late-penalty-rate'
import { stableStringify } from '../../fabric/utils/canonical-json'
import { buildPenaltyArgs } from '../../fabric/utils/ledger-action-args'
import { LedgerOutboxService } from '../../fabric/services/ledger-outbox.service'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { RentalTransactionEventService } from '../../rental/services/rental-transaction-event.service'
import { Payment } from '../schemas/payment.schema'
import { computeLatePenalty, daysLateBetween } from '../utils/late-penalty'
import { vietnamDateKey } from '../utils/payment-reminder.util'

/** Hạn trả khoản lãi: 7 ngày sau ngày trả khoản gốc. */
const PENALTY_DUE_DAYS = 7
const MS_PER_DAY = 86_400_000
/** Trần lãi chậm trả (%/năm); chaincode từ chối tỷ lệ cao hơn. */
const MAX_LATE_PENALTY_RATE = 20
/** Chaincode ABI đầu tiên có `recordPenalty`. */
const RECORD_PENALTY_MIN_ABI_VERSION = 3
/** Job quét bù chỉ xét hóa đơn trả trong khoảng này, để không quét cả bảng. */
const SWEEP_WINDOW_DAYS = 14
const DUPLICATE_KEY_CODE = 11000

function isDuplicateKeyError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown }
  return (
    candidate?.code === DUPLICATE_KEY_CODE ||
    (typeof candidate?.message === 'string' &&
      candidate.message.includes('E11000'))
  )
}

function formatVnd(amount: number): string {
  return amount.toLocaleString('vi-VN')
}

/**
 * Tính và ghi nhận lãi chậm trả tiền thuê theo điều khoản đã ký. Sàn không thu, không giữ
 * và không tự trừ khoản phạt: hệ thống chỉ sinh hóa đơn `penalty`, thông báo và lưu bằng
 * chứng; khách thuê trả thẳng cho chủ nhà qua luồng thanh toán hiện có.
 */
@Injectable()
export class LatePenaltyService {
  private readonly logger = new Logger(LatePenaltyService.name)

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @Optional() private readonly notificationsService?: NotificationsService,
    @Optional() private readonly ledgerOutboxService?: LedgerOutboxService,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService
  ) {}

  /**
   * Gọi ngay sau khi hóa đơn `rent` chuyển `paid`. Trả về hóa đơn `penalty` (mới hoặc đã có),
   * hoặc `null` khi không phát sinh lãi. Gọi lại nhiều lần vẫn chỉ có một hóa đơn.
   */
  async assessForPaidRent(payment: Payment): Promise<Payment | null> {
    if ((payment.type ?? 'rent') !== 'rent') return null
    if (payment.status !== 'paid' || !payment.paidAt) return null

    const daysLate = daysLateBetween(payment.dueDate, payment.paidAt)
    if (daysLate <= 0) return null

    const contract = await this.findContract(payment.contractId)
    if (!contract) return null
    const ratePerYear = resolveLatePenaltyRate(contract)
    if (ratePerYear <= 0) return null
    if (ratePerYear > MAX_LATE_PENALTY_RATE) {
      this.logger.warn(
        `Late penalty skipped for ${payment._id.toHexString()}: rate ${ratePerYear} exceeds ${MAX_LATE_PENALTY_RATE}`
      )
      return null
    }
    const amount = computeLatePenalty(payment.amount, ratePerYear, daysLate)
    if (amount <= 0) return null

    const sourcePaymentId = payment._id.toHexString()
    const periodKey = `late-${sourcePaymentId}`
    const existing = await this.findPenalty(payment.contractId, periodKey)
    if (existing) return existing

    const now = new Date()
    const latePenalty = {
      baseAmount: payment.amount,
      ratePerYear,
      daysLate,
      dueDateKey: vietnamDateKey(payment.dueDate),
      paidDateKey: vietnamDateKey(payment.paidAt),
    }
    const draft = this.paymentRepository.create({
      contractId: payment.contractId,
      tenantId: payment.tenantId,
      landlordId: payment.landlordId,
      payerId: payment.tenantId,
      payerRole: 'tenant',
      payeeRole: 'landlord',
      amount,
      description: `Lãi chậm trả ${payment.periodKey ?? sourcePaymentId}`,
      dueDate: new Date(
        payment.paidAt.getTime() + PENALTY_DUE_DAYS * MS_PER_DAY
      ),
      paidAt: null,
      status: 'unpaid',
      txHash: null,
      type: 'penalty',
      periodKey,
      sourcePaymentId,
      latePenalty,
      // recordPayment chỉ phát sinh khi khoản phạt được trả; bằng chứng lãi nằm ở assessmentEvidence.
      ledgerStatus: 'not-required',
    })

    let penalty: Payment
    try {
      penalty = await this.paymentRepository.save(draft)
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error
      // Callback và job chạy song song: bên kia đã tạo trước, coi như đã có.
      return this.findPenalty(payment.contractId, periodKey)
    }

    const penaltyHash = this.buildPenaltyHash(penalty, latePenalty)
    penalty.assessmentEvidence = {
      manifestVersion: 1,
      manifestHash: penaltyHash,
      ledgerStatus: 'pending',
      txHash: null,
      blockNumber: null,
      recordedAt: now,
    }
    penalty = await this.paymentRepository.save(penalty)

    await this.enqueueLedgerEvidence(penalty, penaltyHash, payment)
    await this.recordAudit(penalty)
    await this.notifyAssessed(penalty, payment)
    return penalty
  }

  /**
   * Quét bù: hóa đơn `rent` trả trễ gần đây mà chưa có khoản lãi (callback lỗi hoặc dịch vụ
   * tạm ngừng). Mỗi lần gọi `assessForPaidRent` đều idempotent nên chạy lại không sinh thêm.
   */
  async assessMissing(now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - SWEEP_WINDOW_DAYS * MS_PER_DAY)
    const paidRent = await this.paymentRepository.find({
      where: {
        type: 'rent',
        status: 'paid',
        paidAt: { $gte: since },
      } as unknown as FindOptionsWhere<Payment>,
    })
    let created = 0
    for (const payment of paidRent) {
      const existing = await this.findPenalty(
        payment.contractId,
        `late-${payment._id.toHexString()}`
      )
      if (existing) continue
      try {
        if (await this.assessForPaidRent(payment)) created += 1
      } catch (error) {
        this.logger.warn(
          `Late penalty sweep failed for ${payment._id.toHexString()}: ${error instanceof Error ? error.message : 'unknown'}`
        )
      }
    }
    return created
  }

  private async findContract(contractId: string): Promise<Contract | null> {
    if (!ObjectId.isValid(contractId)) return null
    return this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
  }

  private findPenalty(
    contractId: string,
    periodKey: string
  ): Promise<Payment | null> {
    return this.paymentRepository.findOne({
      where: { contractId, type: 'penalty', periodKey },
    })
  }

  /** Băm cố định các số liệu đã chốt, chaincode lưu giá trị này làm `penaltyHash`. */
  private buildPenaltyHash(
    penalty: Payment,
    latePenalty: NonNullable<Payment['latePenalty']>
  ): string {
    return createHash('sha256')
      .update(
        stableStringify({
          version: 1,
          penaltyId: penalty._id.toHexString(),
          contractId: penalty.contractId,
          sourcePaymentId: penalty.sourcePaymentId,
          amount: penalty.amount,
          ...latePenalty,
        })
      )
      .digest('hex')
  }

  private async enqueueLedgerEvidence(
    penalty: Payment,
    penaltyHash: string,
    source: Payment
  ): Promise<void> {
    if (!this.ledgerOutboxService || !penalty.latePenalty) return
    const penaltyId = penalty._id.toHexString()
    const sourcePaymentId = source._id.toHexString()
    await this.ledgerOutboxService.enqueue({
      aggregateType: 'penalty',
      aggregateId: penaltyId,
      eventType: 'penalty.assessed',
      action: 'recordPenalty',
      args: buildPenaltyArgs({
        penaltyId,
        contractId: penalty.contractId,
        sourcePaymentId,
        baseAmount: penalty.latePenalty.baseAmount,
        ratePerYear: penalty.latePenalty.ratePerYear,
        daysLate: penalty.latePenalty.daysLate,
        amount: penalty.amount,
        penaltyHash,
      }),
      metadata: {
        paymentId: penaltyId,
        contractId: penalty.contractId,
        // Chờ chaincode có `recordPenalty` thay vì tiêu hao số lần thử.
        minimumAbiVersion: RECORD_PENALTY_MIN_ABI_VERSION,
        waitingCode: 'CHAINCODE_UPGRADE_REQUIRED',
        details: { sourcePaymentId, penaltyHash },
      },
      dependencyKey: `payment:${sourcePaymentId}:payment.paid`,
    })
  }

  private async recordAudit(penalty: Payment): Promise<void> {
    if (!this.transactionEventService) return
    try {
      await this.transactionEventService.record({
        transactionKey: penalty.contractId,
        contractId: penalty.contractId,
        eventType: 'penalty.assessed',
        actorRole: 'system',
        refs: { paymentId: penalty._id.toHexString() },
        transitionKey: `penalty:${penalty._id.toHexString()}:assessed`,
      })
    } catch (error) {
      this.logger.warn(
        `Penalty audit failed for ${penalty._id.toHexString()}: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  private async notifyAssessed(
    penalty: Payment,
    source: Payment
  ): Promise<void> {
    const detail = penalty.latePenalty
    if (!this.notificationsService || !detail) return
    const penaltyId = penalty._id.toHexString()
    const dueText = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(penalty.dueDate)
    const calculation =
      `${formatVnd(detail.baseAmount)} VND × ${detail.ratePerYear}%/năm × ` +
      `${detail.daysLate} ngày / 365 = ${formatVnd(penalty.amount)} VND`
    const data = {
      paymentId: penaltyId,
      sourcePaymentId: source._id.toHexString(),
      contractId: penalty.contractId,
      amount: penalty.amount,
      daysLate: detail.daysLate,
      ratePerYear: detail.ratePerYear,
      dueDate: penalty.dueDate.toISOString(),
    }
    const messages: Array<[string, string]> = [
      [
        penalty.tenantId,
        `Hóa đơn tiền thuê trả trễ ${detail.daysLate} ngày nên phát sinh lãi chậm trả theo hợp đồng: ${calculation}. Hạn trả ${dueText}. Bạn trả trực tiếp cho chủ nhà; nền tảng không thu hộ.`,
      ],
      [
        penalty.landlordId,
        `Khách thuê trả trễ ${detail.daysLate} ngày nên phát sinh lãi chậm trả theo hợp đồng: ${calculation}. Hạn trả ${dueText}. Khoản này khách trả trực tiếp cho bạn; bạn có thể miễn khoản này kèm lý do.`,
      ],
    ]
    for (const [userId, body] of messages) {
      try {
        await this.notificationsService.createNotificationOnce(
          userId,
          `penalty:${penaltyId}:assessed`,
          'Lãi chậm trả tiền thuê',
          body,
          'LATE_PENALTY_ASSESSED',
          data
        )
      } catch (error) {
        this.logger.warn(
          `Late penalty notification failed for ${penaltyId}: ${error instanceof Error ? error.message : 'unknown'}`
        )
      }
    }
  }
}
