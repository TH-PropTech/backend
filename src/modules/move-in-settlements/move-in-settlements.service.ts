import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { Contract } from '../contracts/schemas/contract.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { NotificationsService } from '../notifications/notifications.service'
import { RentalTransactionEventService } from '../rental-transactions/rental-transaction-event.service'
import type { RentalTransactionActorRole } from '../rental-transactions/schemas/rental-transaction-event.schema'
import {
  MoveInSettlement,
  type SettlementLine,
} from './schemas/move-in-settlement.schema'

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
    private readonly transactionEventService?: RentalTransactionEventService
  ) {}

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
    if (!policy && !tenantFee) return null
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
    if (firstRent)
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
      inventoryReference?: string
      notes?: string
      overrideReason?: string
      isStaff?: boolean
    }
  ): Promise<MoveInSettlement> {
    const settlement = await this.find(id)
    if (actorId !== settlement.landlordId && !input.isStaff)
      throw new ConflictException('HANDOVER_ACCESS_DENIED')
    if (settlement.handover?.completedAt)
      throw new ConflictException('HANDOVER_COMPLETED_IMMUTABLE')
    if (
      settlement.status !== 'paid' &&
      !(input.isStaff && input.overrideReason?.trim())
    )
      throw new ConflictException('HANDOVER_REQUIRES_SETTLEMENT')
    const revision = (settlement.handover?.revision ?? 0) + 1
    const body = {
      revision,
      handedOverAt: new Date(input.handedOverAt).toISOString(),
      electricity: input.electricity,
      water: input.water,
      keyCount: input.keyCount,
      inventoryReference: input.inventoryReference ?? null,
      notes: input.notes ?? null,
    }
    const handoverHash = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex')
    settlement.handover = {
      revision,
      handedOverAt: new Date(input.handedOverAt),
      meterReadings: { electricity: input.electricity, water: input.water },
      keyCount: input.keyCount,
      inventoryReference: input.inventoryReference ?? null,
      notes: input.notes ?? null,
      handoverHash,
      recordedBy: actorId,
      tenantConfirmation: null,
      landlordConfirmation: null,
      discrepancyNote: null,
      overrideReason: input.overrideReason ?? null,
      completedAt: null,
    }
    const saved = await this.settlementRepo.save(settlement)
    await this.recordTransactionEvent({
      contractId: saved.contractId,
      eventType: 'settlement.handover-recorded',
      actorRole: input.isStaff ? 'staff' : 'landlord',
      actorId,
      refs: { settlementId: saved._id.toHexString() },
      transitionKey: `settlement:${saved._id.toHexString()}:handover-recorded:${revision}`,
    })
    return saved
  }

  async confirmHandover(
    id: string,
    actorId: string,
    role: 'tenant' | 'landlord',
    handoverHash: string,
    discrepancyNote?: string
  ): Promise<MoveInSettlement> {
    const settlement = await this.find(id)
    const handover = settlement.handover
    if (!handover) throw new ConflictException('HANDOVER_NOT_RECORDED')
    if (handover.completedAt) return settlement
    if (handover.handoverHash !== handoverHash)
      throw new ConflictException('HANDOVER_REVISION_STALE')
    if (
      (role === 'tenant' && settlement.tenantId !== actorId) ||
      (role === 'landlord' && settlement.landlordId !== actorId)
    )
      throw new ConflictException('HANDOVER_ACCESS_DENIED')
    if (role === 'tenant')
      handover.tenantConfirmation = { at: new Date(), hash: handoverHash }
    else handover.landlordConfirmation = { at: new Date(), hash: handoverHash }
    if (discrepancyNote) handover.discrepancyNote = discrepancyNote
    const justCompleted =
      !handover.completedAt &&
      handover.tenantConfirmation?.hash === handoverHash &&
      handover.landlordConfirmation?.hash === handoverHash
    if (justCompleted) {
      handover.completedAt = new Date()
    }
    const saved = await this.settlementRepo.save(settlement)
    if (justCompleted) {
      await this.recordTransactionEvent({
        contractId: saved.contractId,
        eventType: 'settlement.handover-completed',
        actorRole: role,
        actorId,
        refs: { settlementId: saved._id.toHexString() },
        transitionKey: `settlement:${saved._id.toHexString()}:handover-completed`,
      })
    }
    return saved
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
