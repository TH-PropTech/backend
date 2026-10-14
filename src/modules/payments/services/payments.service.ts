import {
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
import { Repository } from 'typeorm'
import { Contract } from '../../contracts/schemas/contract.schema'
import { LedgerOutboxService } from '../../fabric/services/ledger-outbox.service'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { generatePaymentSchedule } from '../utils/payment-schedule.util'
import { reminderDateKey, vietnamDateKey } from '../utils/payment-reminder.util'
import { Payment } from '../schemas/payment.schema'
import { OwnershipTransferResolver } from '../../contracts/services/ownership-transfer.resolver'
import { resolveEffectiveCommercial } from '../../contracts/commercial/resolve-effective-commercial'
import { RentalTransactionEventService } from '../../rental/services/rental-transaction-event.service'
import { PayoutsService } from '../../wallets/services/payouts.service'

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
    @Optional() private readonly moduleRef?: ModuleRef
  ) {}

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
        dueDate.getDate() + (line.payerRole === 'landlord' ? 7 : 1)
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

  async getByContract(
    contractId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<Payment[]> {
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
      }))
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
        args: [
          payment._id.toHexString(),
          payment.contractId,
          payment.amount.toString(),
          payment.paymentHash,
        ],
        metadata: {
          paymentId: payment._id.toHexString(),
          contractId: payment.contractId,
          details: { confirmedBy: actorId },
        },
        dependencyKey: `contract:${payment.contractId}:contract.activated`,
      })
    }
    await this.createPayoutFor(saved)
    return saved
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
        await this.notificationsService.createNotification(
          payment.tenantId,
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

    return { overdue, reminders }
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
