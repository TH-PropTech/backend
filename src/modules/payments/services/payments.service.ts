import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { createHash } from 'node:crypto'
import type { FindOptionsWhere, Repository } from 'typeorm'
import { Contract } from '../../contracts/schemas/contract.schema'
import { FabricService } from '../../fabric/services/fabric.service'
import { LedgerOutboxService } from '../../fabric/services/ledger-outbox.service'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { generatePaymentSchedule } from '../utils/payment-schedule.util'
import { reminderDateKey, vietnamDateKey } from '../utils/payment-reminder.util'
import { Payment } from '../schemas/payment.schema'
import { OwnershipTransferResolver } from '../../contracts/services/ownership-transfer.resolver'
import { resolveEffectiveCommercial } from '../../contracts/commercial/resolve-effective-commercial'
import { RentalTransactionEventService } from '../../rental/services/rental-transaction-event.service'
import { PayoutsService } from '../../wallets/services/payouts.service'
import { PlatformFeeScheduleRepository } from '../utils/platform-fee-schedule.repository'
import { buildPaymentLedgerArgs } from '../utils/payment-ledger-args'
import { computeLatePenalty, daysLateBetween } from '../utils/late-penalty'
import { resolveLatePenaltyRate } from '../../contracts/commercial/resolve-late-penalty-rate'
import { LatePenaltyService } from './late-penalty.service'

/** Link chuông thông báo -> tab ví trong hồ sơ (nơi chủ nhà thanh toán hóa đơn). */
const PLATFORM_FEE_NOTIFICATION_LINK = '/profile?tab=wallet'
const DEFAULT_LANDLORD_FEE_DUE_DAYS = 7
/** Hợp đồng cho phép Bên cho thuê đơn phương chấm dứt khi tiền thuê trễ quá số ngày này. */
const LEASE_TERMINATION_RIGHT_AFTER_DAYS = 15

/** Hóa đơn kèm các trường chỉ để hiển thị; không lưu xuống DB. */
export type PaymentView = Payment & {
  /** Số ngày trễ tính đến hôm nay (hóa đơn `rent` đang `overdue`), ngược lại `null`. */
  daysLate: number | null
  /** Lãi tạm tính; `null` khi không phải hóa đơn `rent` quá hạn hoặc hợp đồng không có lãi. */
  accruedLateInterest: number | null
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name)

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    private readonly notificationsService?: NotificationsService,
    @Optional() private readonly ledgerOutboxService?: LedgerOutboxService,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService,
    @Optional() private readonly payoutsService?: PayoutsService,
    // OwnershipTransferResolver nằm trong ContractsModule, không được
    // payments.module.ts import trực tiếp (né vòng contracts <-> payments)
    // → tra cứu lazy qua ModuleRef tại điểm gọi .canAccessPayment(...),
    // giữ nguyên ngữ nghĩa optional cũ (không có thì dùng fallback check).
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional()
    private readonly feeScheduleRepository?: PlatformFeeScheduleRepository,
    @Optional() private readonly fabricService?: FabricService,
    @Optional() private readonly latePenaltyService?: LatePenaltyService
  ) {}

  /** dueDaysAfterActivation theo biểu phí đã chốt trong snapshot hợp đồng; mặc định 7. */
  private async resolveLandlordDueDays(contract: Contract): Promise<number> {
    const snapshot = contract.feeSnapshot
    if (!snapshot || !this.feeScheduleRepository)
      return DEFAULT_LANDLORD_FEE_DUE_DAYS
    try {
      const schedule = await this.feeScheduleRepository.findOne({
        where: { scheduleId: snapshot.scheduleId, version: snapshot.version },
      })
      const days = schedule?.rules?.landlordCommission?.dueDaysAfterActivation
      return typeof days === 'number' && Number.isFinite(days) && days >= 0
        ? days
        : DEFAULT_LANDLORD_FEE_DUE_DAYS
    } catch {
      return DEFAULT_LANDLORD_FEE_DUE_DAYS
    }
  }

  private async notifyPlatformFeeIssued(invoice: Payment): Promise<void> {
    if (!this.notificationsService || !invoice.payerId) return
    try {
      const paymentId = invoice._id.toHexString()
      const dueText = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(invoice.dueDate)
      await this.notificationsService.createNotificationOnce(
        invoice.payerId,
        `fee:${paymentId}:issued`,
        'Phí hoa hồng cần thanh toán',
        `Bạn có khoản phí hoa hồng ${invoice.amount.toLocaleString('vi-VN')} VND cần thanh toán trước ngày ${dueText}. Quét mã Ví Mộc để thanh toán.`,
        'PLATFORM_FEE_INVOICE',
        {
          paymentId,
          contractId: invoice.contractId,
          amount: invoice.amount,
          dueDate: invoice.dueDate.toISOString(),
          link: PLATFORM_FEE_NOTIFICATION_LINK,
        }
      )
    } catch (error) {
      this.logger.warn(
        `Platform fee notification failed for ${invoice._id.toHexString()}: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  private resolveOwnershipTransferResolver():
    | OwnershipTransferResolver
    | undefined {
    return this.moduleRef?.get(OwnershipTransferResolver, { strict: false })
  }

  private async recordTransactionEvent(input: {
    contractId: string
    eventType: string
    actorRole: 'tenant' | 'landlord' | 'staff' | 'admin' | 'system' | 'provider'
    actorId?: string | null
    reasonCode?: string | null
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
        reasonCode: input.reasonCode ?? null,
        refs: { contractId: input.contractId, ...(input.refs ?? {}) },
        transitionKey: input.transitionKey,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Rental transaction audit failed for payments event [${input.eventType}]: ${message}`
      )
    }
  }

  async generateSchedule(contract: Contract): Promise<Payment[]> {
    const contractId = contract._id.toString()
    const existing = await this.paymentRepository.find({
      where: { contractId, type: 'rent' },
    })
    const existingPeriods = new Set(
      existing.map(payment => payment.periodKey).filter(Boolean)
    )
    const commercial = resolveEffectiveCommercial(contract)
    const durationMonths =
      commercial.durationMonths ?? this.calculateDurationMonths(contract)
    const schedule = generatePaymentSchedule({
      contractId,
      startDate: contract.startDate,
      durationMonths,
      monthlyRent: commercial.monthlyRent,
      paymentDay: commercial.paymentDay,
      cycleMonths: contract.paymentCycleMonths ?? 1,
      ...(typeof contract.prepaidRentMonths === 'number'
        ? { prepaidMonths: contract.prepaidRentMonths }
        : {}),
    })

    const newPayments: Payment[] = []
    for (const item of schedule) {
      if (existingPeriods.has(item.periodKey)) continue
      const payment = this.paymentRepository.create({
        contractId: item.contractId,
        tenantId: contract.tenantId,
        landlordId: contract.landlordId,
        amount: item.amount,
        description: `Rent ${item.periodKey}`,
        dueDate: item.dueDate,
        paidAt: null,
        status: item.status,
        txHash: null,
        type: 'rent',
        month: item.dueDate.getUTCMonth() + 1,
        year: item.dueDate.getUTCFullYear(),
        periodKey: item.periodKey,
        ...(item.cycleMonths !== undefined
          ? { cycleMonths: item.cycleMonths }
          : {}),
        ...(item.periodStart ? { periodStart: item.periodStart } : {}),
        ...(item.periodEnd ? { periodEnd: item.periodEnd } : {}),
        ledgerStatus: 'not-required',
      })
      newPayments.push(await this.paymentRepository.save(payment))
    }
    return [...existing, ...newPayments]
  }

  async generatePlatformFeeInvoices(contract: Contract): Promise<Payment[]> {
    const snapshot = contract.feeSnapshot
    if (!snapshot) return []
    const created: Payment[] = []
    for (const line of snapshot.quote) {
      const periodKey = `FEE:${line.feeKind}`
      const existing = await this.paymentRepository.findOne({
        where: {
          contractId: contract._id.toHexString(),
          type: 'platform-fee',
          periodKey,
        },
      })
      if (existing) {
        created.push(existing)
        continue
      }
      const payerId =
        line.payerRole === 'landlord' ? contract.landlordId : contract.tenantId
      const dueDate = new Date()
      dueDate.setDate(
        dueDate.getDate() +
          (line.payerRole === 'landlord'
            ? await this.resolveLandlordDueDays(contract)
            : 1)
      )
      const invoice = this.paymentRepository.create({
        contractId: contract._id.toHexString(),
        tenantId: contract.tenantId,
        landlordId: contract.landlordId,
        payerId,
        payerRole: line.payerRole,
        payeeRole: 'platform',
        feeKind: line.feeKind,
        amountBeforeVat: line.amountBeforeVat,
        vatAmount: line.vatAmount,
        amount: line.amount,
        description:
          line.feeKind === 'LANDLORD_COMMISSION'
            ? 'Landlord platform commission'
            : 'Tenant service fee',
        dueDate,
        paidAt: null,
        status: 'unpaid',
        txHash: null,
        type: 'platform-fee',
        periodKey,
        ledgerStatus: 'pending',
      })
      const saved = await this.paymentRepository.save(invoice)
      await this.recordTransactionEvent({
        contractId: contract._id.toHexString(),
        eventType: 'fee.issued',
        actorRole: 'system',
        refs: { paymentId: saved._id.toHexString() },
        transitionKey: `fee:${saved._id.toHexString()}:issued`,
      })
      if (line.payerRole === 'landlord')
        await this.notifyPlatformFeeIssued(saved)
      created.push(saved)
    }
    return created
  }

  async waivePlatformFee(
    paymentId: string,
    actorId: string,
    reason: string
  ): Promise<Payment> {
    if (!ObjectId.isValid(paymentId))
      throw new NotFoundException('PAYMENT_NOT_FOUND')
    const payment = await this.paymentRepository.findOne({
      where: { _id: new ObjectId(paymentId) },
    })
    if (!payment || payment.type !== 'platform-fee')
      throw new NotFoundException('PLATFORM_FEE_INVOICE_NOT_FOUND')
    if (payment.status === 'paid')
      throw new ConflictException('PAID_PLATFORM_FEE_CANNOT_BE_WAIVED')
    if (!reason.trim())
      throw new ConflictException('PLATFORM_FEE_WAIVE_REASON_REQUIRED')
    if (payment.status === 'waived') return payment
    payment.status = 'waived'
    payment.waivedBy = actorId
    payment.waivedAt = new Date()
    payment.waiveReason = reason.trim()
    const saved = await this.paymentRepository.save(payment)
    await this.recordTransactionEvent({
      contractId: saved.contractId,
      eventType: 'fee.waived',
      actorRole: 'staff',
      actorId,
      reasonCode: saved.waiveReason ?? null,
      refs: { paymentId: saved._id.toHexString() },
      transitionKey: `fee:${saved._id.toHexString()}:waived`,
    })
    return saved
  }

  /**
   * Chủ nhà miễn khoản lãi chậm trả chưa thanh toán. Sàn không thu hay giữ khoản phạt nên
   * quyết định miễn thuộc hoàn toàn về chủ nhà; việc miễn được ghi thành sự kiện giao dịch.
   */
  async waivePenalty(
    paymentId: string,
    landlordId: string,
    reason: string
  ): Promise<Payment> {
    if (!ObjectId.isValid(paymentId)) {
      throw new NotFoundException('PAYMENT_NOT_FOUND')
    }
    const payment = await this.paymentRepository.findOne({
      where: { _id: new ObjectId(paymentId) },
    })
    if (!payment || payment.type !== 'penalty') {
      throw new NotFoundException('PAYMENT_NOT_FOUND')
    }
    const contract = await this.findContract(payment.contractId)
    if (contract.landlordId !== landlordId) {
      throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
    }
    if (payment.status === 'paid') {
      throw new ConflictException('PENALTY_ALREADY_PAID')
    }
    if (payment.status === 'waived') return payment
    const trimmedReason = reason?.trim() ?? ''
    if (!trimmedReason) {
      throw new BadRequestException('PENALTY_WAIVE_REASON_REQUIRED')
    }

    payment.status = 'waived'
    payment.waivedBy = landlordId
    payment.waivedAt = new Date()
    payment.waiveReason = trimmedReason
    const saved = await this.paymentRepository.save(payment)
    await this.recordTransactionEvent({
      contractId: saved.contractId,
      eventType: 'penalty.waived',
      actorRole: 'landlord',
      actorId: landlordId,
      reasonCode: trimmedReason,
      refs: { paymentId: saved._id.toHexString() },
      transitionKey: `penalty:${saved._id.toHexString()}:waived`,
    })
    await this.notifyPenaltyWaived(saved)
    return saved
  }

  private async notifyPenaltyWaived(penalty: Payment): Promise<void> {
    if (!this.notificationsService) return
    try {
      const paymentId = penalty._id.toHexString()
      await this.notificationsService.createNotificationOnce(
        penalty.tenantId,
        `penalty:${paymentId}:waived`,
        'Chủ nhà đã miễn lãi chậm trả',
        `Chủ nhà đã miễn khoản lãi chậm trả ${penalty.amount.toLocaleString('vi-VN')} VND. Lý do: ${penalty.waiveReason ?? ''}. Bạn không cần thanh toán khoản này.`,
        'LATE_PENALTY_WAIVED',
        { paymentId, contractId: penalty.contractId, amount: penalty.amount }
      )
    } catch (error) {
      this.logger.warn(
        `Penalty waiver notification failed for ${penalty._id.toHexString()}: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  async getByContract(
    contractId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<PaymentView[]> {
    const contract = await this.findContract(contractId)
    const ownershipTransferResolver = this.resolveOwnershipTransferResolver()
    const canAccess = ownershipTransferResolver
      ? await ownershipTransferResolver.canAccessPayment(
          actorId,
          {
            landlordId: contract.landlordId,
            tenantId: contract.tenantId,
          },
          contract,
          isStaff
        )
      : isStaff ||
        contract.tenantId === actorId ||
        contract.landlordId === actorId
    if (!canAccess) {
      throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
    }
    const payments = await this.paymentRepository.find({
      where: { contractId },
      order: { dueDate: 'ASC' },
    })
    const ratePerYear = resolveLatePenaltyRate(contract)
    const now = new Date()
    return payments
      .filter(
        payment =>
          payment.type !== 'platform-fee' ||
          isStaff ||
          (payment.payerId ?? payment.tenantId) === actorId
      )
      .map(payment => ({
        ...payment,
        payerId: payment.payerId ?? payment.tenantId,
        payerRole: payment.payerRole ?? 'tenant',
        payeeRole: payment.payeeRole ?? 'landlord',
        ...this.accruedLateInterest(payment, ratePerYear, now),
      }))
  }

  /**
   * Lãi tạm tính của hóa đơn `rent` đang quá hạn, chỉ để hiển thị: không lưu, không sinh hóa
   * đơn, không ghi sổ cái. Số tiền chốt khi hóa đơn được thanh toán (`LatePenaltyService`).
   */
  private accruedLateInterest(
    payment: Payment,
    ratePerYear: number,
    now: Date
  ): Pick<PaymentView, 'daysLate' | 'accruedLateInterest'> {
    if ((payment.type ?? 'rent') !== 'rent' || payment.status !== 'overdue') {
      return { daysLate: null, accruedLateInterest: null }
    }
    const daysLate = Math.max(0, daysLateBetween(payment.dueDate, now))
    return {
      daysLate,
      accruedLateInterest:
        ratePerYear > 0
          ? computeLatePenalty(payment.amount, ratePerYear, daysLate)
          : null,
    }
  }

  async confirmPayment(
    paymentId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<Payment> {
    if (!ObjectId.isValid(paymentId)) {
      throw new NotFoundException('PAYMENT_NOT_FOUND')
    }
    const payment = await this.paymentRepository.findOne({
      where: { _id: new ObjectId(paymentId) },
    })
    if (!payment) throw new NotFoundException('PAYMENT_NOT_FOUND')
    if (!isStaff && payment.tenantId !== actorId) {
      throw new ForbiddenException('PAYMENT_ACCESS_DENIED')
    }
    if (payment.status === 'paid') return payment

    payment.status = 'paid'
    payment.paidAt = new Date()
    payment.confirmedBy = actorId
    payment.paymentHash = this.buildPaymentHash(payment)
    payment.ledgerStatus = 'pending'
    const saved = await this.paymentRepository.save(payment)
    if (this.ledgerOutboxService) {
      await this.ledgerOutboxService.enqueue({
        aggregateType: 'payment',
        aggregateId: payment._id.toHexString(),
        eventType: 'payment.paid',
        action: 'recordPayment',
        args: buildPaymentLedgerArgs(
          { ...payment, paymentHash: payment.paymentHash },
          this.fabricService?.getChaincodeAbiVersion() ?? 2
        ),
        metadata: {
          paymentId: payment._id.toHexString(),
          contractId: payment.contractId,
          details: { confirmedBy: actorId },
        },
        dependencyKey: `contract:${payment.contractId}:contract.activated`,
      })
    }
    await this.createPayoutFor(saved)
    await this.assessLatePenalty(saved)
    return saved
  }

  /** Lỗi tính lãi không được làm hỏng giao dịch đã thanh toán; job quét bù sẽ tạo lại khoản còn thiếu. */
  private async assessLatePenalty(payment: Payment): Promise<void> {
    if (!this.latePenaltyService) return
    try {
      await this.latePenaltyService.assessForPaidRent(payment)
    } catch (error) {
      this.logger.warn(
        `Late penalty assessment failed for payment ${payment._id.toHexString()}: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  private async createPayoutFor(payment: Payment): Promise<void> {
    if (!this.payoutsService) return
    if (payment.type === 'platform-fee' || payment.payeeRole === 'platform')
      return
    try {
      await this.payoutsService.createForPayment({
        paymentId: payment._id.toHexString(),
        contractId: payment.contractId ?? null,
        landlordId: payment.landlordId,
        amount: payment.amount,
      })
    } catch (error) {
      this.logger.warn(
        `Payout creation failed for payment ${payment._id.toHexString()}: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  async getOverdue(): Promise<Payment[]> {
    return this.paymentRepository.find({
      where: { status: 'overdue' },
      order: { dueDate: 'ASC' },
    })
  }

  async markOverdue(now = new Date()): Promise<number> {
    const result = await this.processReminders(now)
    return result.overdue
  }

  async processReminders(
    now = new Date()
  ): Promise<{ overdue: number; reminders: number }> {
    const todayKey = vietnamDateKey(now)
    const payments = await this.paymentRepository.find({
      where: { status: 'unpaid' },
    })
    let overdue = 0
    let reminders = 0

    for (const payment of payments) {
      const dueDateKey = vietnamDateKey(payment.dueDate)
      const shouldMarkOverdue = dueDateKey < todayKey
      const reminderKey = reminderDateKey(payment.dueDate)
      const shouldRemind =
        reminderKey === todayKey && payment.reminderSentForDate !== reminderKey

      if (!shouldMarkOverdue && !shouldRemind) continue
      if (shouldRemind) {
        if (!this.notificationsService) continue
        const recipientId =
          payment.type === 'platform-fee' &&
          payment.payerRole === 'landlord' &&
          payment.payerId
            ? payment.payerId
            : payment.tenantId
        await this.notificationsService.createNotification(
          recipientId,
          'Rent payment reminder',
          `Rent invoice ${payment.periodKey ?? payment._id.toString()} is due on ${dueDateKey}.`,
          'PAYMENT_REMINDER',
          {
            paymentId: payment._id.toString(),
            contractId: payment.contractId,
            dueDate: dueDateKey,
            reminderDate: reminderKey,
          }
        )
        payment.reminderSentForDate = reminderKey
        payment.reminderSentAt = now
        reminders += 1
      }
      if (shouldMarkOverdue) {
        payment.status = 'overdue'
        overdue += 1
      }
      await this.paymentRepository.save(payment)
    }

    await this.sendOverdueEscalations(now)
    return { overdue, reminders }
  }

  /**
   * Bậc thang vi phạm thanh toán tiền thuê: thông báo quá hạn (văn bản nhắc theo hợp đồng) và
   * thông báo Bên cho thuê đủ điều kiện đơn phương chấm dứt khi trễ quá 15 ngày. Mỗi loại gửi
   * đúng một lần (cờ trên hóa đơn cộng khóa chống trùng của thông báo). Hệ thống không tự
   * chấm dứt hợp đồng.
   */
  private async sendOverdueEscalations(now: Date): Promise<void> {
    if (!this.notificationsService) return
    const candidates = await this.paymentRepository.find({
      // Mongo `{ field: null }` khớp cả trường chưa tồn tại (hóa đơn cũ).
      where: {
        status: 'overdue',
        type: 'rent',
        terminationRightNotifiedAt: null,
      } as unknown as FindOptionsWhere<Payment>,
    })
    for (const payment of candidates) {
      if (
        payment.status !== 'overdue' ||
        (payment.type ?? 'rent') !== 'rent' ||
        payment.terminationRightNotifiedAt
      ) {
        continue
      }
      try {
        await this.escalateOverdueRent(payment, now)
      } catch (error) {
        this.logger.warn(
          `Overdue escalation failed for ${payment._id.toHexString()}: ${error instanceof Error ? error.message : 'unknown'}`
        )
      }
    }
  }

  private async escalateOverdueRent(
    payment: Payment,
    now: Date
  ): Promise<void> {
    const notifications = this.notificationsService
    if (!notifications) return
    const paymentId = payment._id.toHexString()
    const label = payment.periodKey ?? paymentId
    const dueDateKey = vietnamDateKey(payment.dueDate)
    const daysLate = daysLateBetween(payment.dueDate, now)
    const data = {
      paymentId,
      contractId: payment.contractId,
      dueDate: dueDateKey,
      daysLate,
    }

    if (!payment.overdueNoticeSentAt) {
      await notifications.createNotificationOnce(
        payment.tenantId,
        `rent:${paymentId}:overdue`,
        'Hóa đơn tiền thuê đã quá hạn',
        `Hóa đơn tiền thuê ${label} đã quá hạn từ ngày ${dueDateKey}. Đây là thông báo nhắc thanh toán theo hợp đồng. Lãi chậm trả được tính theo hợp đồng và chốt khi bạn thanh toán.`,
        'PAYMENT_OVERDUE',
        data
      )
      payment.overdueNoticeSentAt = now
      await this.paymentRepository.save(payment)
    }

    if (daysLate <= LEASE_TERMINATION_RIGHT_AFTER_DAYS) return
    const recipients: Array<[string, string]> = [
      [
        payment.tenantId,
        `Hóa đơn tiền thuê ${label} đã quá hạn ${daysLate} ngày. Theo hợp đồng đã ký, Bên cho thuê đủ điều kiện đơn phương chấm dứt hợp đồng. Hệ thống không tự chấm dứt hợp đồng; hãy thanh toán hoặc liên hệ chủ nhà.`,
      ],
      [
        payment.landlordId,
        `Hóa đơn tiền thuê ${label} đã quá hạn ${daysLate} ngày. Theo hợp đồng đã ký, bạn đủ điều kiện đơn phương chấm dứt hợp đồng. Hệ thống không tự chấm dứt hợp đồng; quyết định thuộc về bạn.`,
      ],
    ]
    for (const [userId, body] of recipients) {
      await notifications.createNotificationOnce(
        userId,
        `rent:${paymentId}:termination-right`,
        'Đủ điều kiện đơn phương chấm dứt hợp đồng',
        body,
        'LEASE_TERMINATION_RIGHT',
        data
      )
    }
    payment.terminationRightNotifiedAt = now
    await this.paymentRepository.save(payment)
  }

  private async findContract(contractId: string): Promise<Contract> {
    if (!ObjectId.isValid(contractId)) {
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    }
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')
    return contract
  }

  private calculateDurationMonths(contract: Contract): number {
    const start = contract.startDate
    const end = contract.endDate
    return Math.max(
      1,
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        end.getUTCMonth() -
        start.getUTCMonth()
    )
  }

  private buildPaymentHash(payment: Payment): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          version: 1,
          paymentId: payment._id.toHexString(),
          contractId: payment.contractId,
          amount: payment.amount,
          dueDate: payment.dueDate.toISOString(),
          paidAt: payment.paidAt?.toISOString() ?? null,
          confirmedBy: payment.confirmedBy ?? null,
        })
      )
      .digest('hex')
  }
}
