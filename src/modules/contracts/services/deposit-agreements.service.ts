import { ApartmentChangeNotifier } from '../../read-model/services/apartment-change-notifier.service'
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { createHash } from 'node:crypto'
import { Repository } from 'typeorm'
import type { FindOptionsWhere } from 'typeorm'
import type { RentalPackageSnapshot } from '../../properties/utils/rental-package.util'
import type { RentalExecutionPolicyRef } from '../../rental/utils/rental-execution-policy.util'
import { Apartment } from '../../properties/schemas/apartment.schema'
import { validateDepositConsent } from '../utils/deposit-consent.util'
import { evaluatePayDeposit } from '../flow/flow-guards'
import { FlowNotificationService } from '../flow/flow-notification.service'
import { Contract } from '../schemas/contract.schema'
import { DepositAgreement } from '../schemas/deposit-agreement.schema'
import { LedgerOutboxService } from '../../fabric/services/ledger-outbox.service'
import { ContractsService } from './contracts.service'
import { OwnershipTransferResolver } from './ownership-transfer.resolver'
import { RentalTransactionEventService } from '../../rental/services/rental-transaction-event.service'
import type { RentalTransactionActorRole } from '../../rental/schemas/rental-transaction-event.schema'

@Injectable()
export class DepositAgreementsService {
  private readonly logger = new Logger(DepositAgreementsService.name)

  constructor(
    @InjectRepository(DepositAgreement)
    private readonly repository: Repository<DepositAgreement>,
    @Optional()
    private readonly ledgerOutboxService?: LedgerOutboxService,
    @Optional()
    @InjectRepository(Apartment)
    private readonly apartmentRepository?: Repository<Apartment>,
    @Optional() private readonly contractsService?: ContractsService,
    @Optional()
    private readonly ownershipTransferResolver?: OwnershipTransferResolver,
    @Optional()
    @InjectRepository(Contract)
    private readonly contractRepository?: Repository<Contract>,
    @Optional()
    private readonly flowNotificationService?: FlowNotificationService,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService,
    @Optional()
    private readonly apartmentChangeNotifier?: ApartmentChangeNotifier
  ) {}

  /** Thỏa thuận cọc gắn với một hợp đồng thuê, nếu có. */
  async findByContractId(
    contractId: string | null | undefined
  ): Promise<DepositAgreement | null> {
    if (!contractId) return null
    return this.repository.findOne({
      where: { linkedLeaseContractId: contractId },
    })
  }

  async reviseSecurityDepositBeforeConsent(
    agreementId: string,
    securityDepositTotal: number
  ): Promise<void> {
    const agreement = await this.findById(agreementId)
    if (agreement.status !== 'draft' || agreement.tenantConsent) {
      throw new ConflictException('COMMERCIAL_DEPOSIT_LOCKED')
    }
    const packageSnapshot = {
      ...agreement.packageSnapshot,
      resolvedDepositAmount: securityDepositTotal,
    }
    const hasHoldingDeposit = agreement.depositKind === 'HOLDING'
    agreement.packageSnapshot = packageSnapshot
    if (hasHoldingDeposit) {
      agreement.securityDepositTotal = securityDepositTotal
      agreement.securityTopUpAmount = Math.max(
        0,
        securityDepositTotal - agreement.amount
      )
    } else {
      agreement.amount = securityDepositTotal
    }
    agreement.contentRevision += 1
    const content = {
      agreementCode: agreement.agreementCode,
      applicationId: agreement.applicationId,
      packageSnapshot,
      purpose: agreement.purpose,
      templateVersion: agreement.templateVersion,
      ...(hasHoldingDeposit
        ? {
            depositKind: agreement.depositKind,
            securityDepositTotal: agreement.securityDepositTotal,
            securityTopUpAmount: agreement.securityTopUpAmount ?? 0,
          }
        : {}),
    }
    agreement.contentHash = createHash('sha256')
      .update(JSON.stringify(content))
      .digest('hex')
    await this.repository.save(agreement)
  }

  async createFromApplicationSnapshot(input: {
    applicationId: string
    propertyId?: string
    tenantId: string
    landlordId: string
    packageSnapshot: RentalPackageSnapshot
    executionPolicySnapshot?: RentalExecutionPolicyRef | null
  }): Promise<DepositAgreement> {
    const existing = await this.repository.findOne({
      where: { applicationId: input.applicationId },
    })
    if (existing) return existing

    const agreementCode = `DPA-${input.applicationId}`
    const resolvedHoldingDepositAmount =
      input.packageSnapshot.resolvedHoldingDepositAmount
    const hasHoldingDeposit = resolvedHoldingDepositAmount !== undefined
    const depositKind = hasHoldingDeposit ? 'HOLDING' : 'FULL_SECURITY'
    const securityTopUpAmount =
      input.packageSnapshot.resolvedSecurityTopUpAmount ?? 0
    const templateVersion = hasHoldingDeposit ? 'deposit-v2' : 'deposit-v1'
    const content = {
      agreementCode,
      applicationId: input.applicationId,
      packageSnapshot: input.packageSnapshot,
      purpose: 'SECURE_CONCLUSION_THEN_PERFORMANCE',
      templateVersion,
      ...(hasHoldingDeposit
        ? {
            depositKind,
            securityDepositTotal: input.packageSnapshot.resolvedDepositAmount,
            securityTopUpAmount,
          }
        : {}),
    }
    const contentHash = createHash('sha256')
      .update(JSON.stringify(content))
      .digest('hex')
    const agreement = this.repository.create({
      agreementCode,
      applicationId: input.applicationId,
      propertyId: input.propertyId ?? null,
      tenantId: input.tenantId,
      landlordId: input.landlordId,
      packageSnapshot: input.packageSnapshot,
      executionPolicySnapshot:
        input.executionPolicySnapshot ??
        input.packageSnapshot.defaultExecutionPolicy ??
        null,
      purpose: 'SECURE_CONCLUSION_THEN_PERFORMANCE',
      dispositionPolicySnapshot: {
        version: 'deposit-disposition-v1',
        note: 'Internal platform template; disposition requires approved policy.',
      },
      amount:
        resolvedHoldingDepositAmount ??
        input.packageSnapshot.resolvedDepositAmount,
      ...(hasHoldingDeposit
        ? {
            depositKind,
            securityDepositTotal: input.packageSnapshot.resolvedDepositAmount,
            securityTopUpAmount,
          }
        : {}),
      templateVersion,
      contentRevision: 1,
      contentHash,
      status: 'draft',
      tenantConsent: null,
      paidAt: null,
      paymentAttemptId: null,
      depositHash: null,
      manualConfirmation: null,
      linkedLeaseContractId: null,
      linkedLeaseContractHash: null,
    })
    return this.repository.save(agreement)
  }

  async createForContract(contractId: string): Promise<DepositAgreement> {
    if (!this.contractRepository || !ObjectId.isValid(contractId)) {
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    }
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')
    if (contract.depositAgreementId) {
      throw new ConflictException('DEPOSIT_AGREEMENT_ALREADY_EXISTS')
    }

    const duration = [1, 3, 6, 12, 24].includes(contract.durationMonths ?? 12)
      ? (contract.durationMonths ?? 12)
      : 12
    const packageSnapshot = contract.packageSnapshot ?? {
      packageId: `legacy-${contract._id.toHexString()}`,
      version: 1,
      durationMonths: duration as 1 | 3 | 6 | 12 | 24,
      monthlyRent: contract.monthlyRent,
      depositPolicy: {
        type: 'FIXED_AMOUNT' as const,
        amount: contract.deposit,
      },
      resolvedDepositAmount: contract.deposit,
      currency: 'VND' as const,
    }
    const agreement = await this.createFromApplicationSnapshot({
      applicationId:
        contract.rentalApplicationId ??
        `contract-${contract._id.toHexString()}`,
      propertyId: contract.propertyId,
      tenantId: contract.tenantId,
      landlordId: contract.landlordId,
      packageSnapshot,
      ...(contract.executionPolicySnapshot
        ? { executionPolicySnapshot: contract.executionPolicySnapshot }
        : {}),
    })
    contract.depositAgreementId = agreement._id.toHexString()
    await this.contractRepository.save(contract)
    return agreement
  }

  async getAgreement(
    id: string,
    actorId: string,
    isStaff: boolean
  ): Promise<DepositAgreement> {
    const agreement = await this.findById(id)
    const canAccess = this.ownershipTransferResolver
      ? await this.ownershipTransferResolver.canAccessDeposit(
          actorId,
          agreement,
          isStaff
        )
      : isStaff ||
        agreement.tenantId === actorId ||
        agreement.landlordId === actorId
    if (!canAccess) {
      throw new ForbiddenException('DEPOSIT_ACCESS_DENIED')
    }
    return agreement
  }

  async consent(
    id: string,
    tenantId: string,
    expectedRevision: number,
    expectedContentHash: string
  ): Promise<DepositAgreement> {
    const agreement = await this.findById(id)
    this.assertTenant(agreement, tenantId)
    if (!['draft', 'accepted'].includes(agreement.status)) {
      throw new ConflictException('DEPOSIT_CONSENT_CLOSED')
    }
    if (agreement.status === 'accepted') {
      validateDepositConsent(agreement, {
        expectedRevision,
        expectedContentHash,
      })
      return agreement
    } else if (
      agreement.contentRevision !== expectedRevision ||
      agreement.contentHash !== expectedContentHash
    ) {
      throw new ConflictException('DEPOSIT_CONSENT_REQUIRED')
    }
    agreement.status = 'accepted'
    agreement.tenantConsent = {
      consentedAt: new Date(),
      contentHash: agreement.contentHash,
    }
    const saved = await this.repository.save(agreement)
    await this.recordTransactionEvent({
      agreement: saved,
      eventType: 'deposit.consented',
      actorRole: 'tenant',
      actorId: tenantId,
      transitionKey: `deposit:${saved._id.toHexString()}:consented`,
    })
    await this.notifyFlow(saved)
    return saved
  }

  async markPaymentPending(
    id: string,
    tenantId: string
  ): Promise<DepositAgreement> {
    const agreement = await this.findById(id)
    this.assertTenant(agreement, tenantId)
    const guard = evaluatePayDeposit({
      status: agreement.status,
      hasConsent: Boolean(agreement.tenantConsent),
    })
    if (!guard.enabled) {
      throw new ConflictException('DEPOSIT_CONSENT_REQUIRED')
    }
    // Attempt mới thay attempt đã hết hạn: thỏa thuận đã ở payment-pending.
    if (agreement.status === 'payment-pending') return agreement
    agreement.status = 'payment-pending'
    return this.repository.save(agreement)
  }

  async cancel(
    id: string,
    actorId: string,
    isStaff = false
  ): Promise<DepositAgreement> {
    const agreement = await this.findById(id)
    if (
      !isStaff &&
      agreement.tenantId !== actorId &&
      agreement.landlordId !== actorId
    ) {
      throw new ForbiddenException('DEPOSIT_ACCESS_DENIED')
    }
    if (agreement.status === 'cancelled') return agreement
    if (
      agreement.status === 'paid' ||
      agreement.status === 'applied-to-lease-security'
    ) {
      throw new ConflictException('DEPOSIT_CANCELLATION_NOT_ALLOWED')
    }
    if (agreement.status === 'expired') return agreement
    agreement.status = 'cancelled'
    const saved = await this.repository.save(agreement)
    await this.releaseReservation(saved)
    return saved
  }

  async expire(id: string): Promise<DepositAgreement> {
    const agreement = await this.findById(id)
    if (agreement.status === 'expired' || agreement.status === 'cancelled') {
      return agreement
    }
    if (
      agreement.status === 'paid' ||
      agreement.status === 'applied-to-lease-security'
    ) {
      throw new ConflictException('DEPOSIT_EXPIRY_NOT_ALLOWED')
    }
    agreement.status = 'expired'
    const saved = await this.repository.save(agreement)
    await this.recordTransactionEvent({
      agreement: saved,
      eventType: 'deposit.expired',
      actorRole: 'system',
      transitionKey: `deposit:${saved._id.toHexString()}:expired`,
    })
    await this.releaseReservation(saved)
    return saved
  }

  /**
   * Sweep vận hành (D10): hết hạn các thỏa thuận cọc còn `draft`/`accepted`
   * quá `ttlHours`. Tái sử dụng `expire()` hiện có cho từng bản ghi nên vẫn
   * đi qua cùng kiểm tra nghiệp vụ và cùng sự kiện audit.
   */
  async expireStale(ttlHours: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000)
    // D7: quét có điều kiện `createdAt < cutoff` thay vì load toàn bộ rồi lọc
    // trong bộ nhớ.
    const candidates = await this.repository.find({
      where: {
        status: { $in: ['draft', 'accepted'] },
        createdAt: { $lt: cutoff },
      } as never,
    })
    let count = 0
    for (const agreement of candidates) {
      await this.expire(agreement._id.toHexString())
      count += 1
    }
    return count
  }

  async recordDepositPaid(
    id: string,
    paymentAttemptId: string,
    depositHash?: string,
    receipt?: { receiptCode: string; receiptHash: string; paidAt: Date }
  ): Promise<DepositAgreement> {
    const agreement = await this.findById(id)
    if (
      agreement.status === 'paid' ||
      agreement.status === 'applied-to-lease-security'
    ) {
      if (
        agreement.paymentAttemptId &&
        agreement.paymentAttemptId !== paymentAttemptId
      ) {
        throw new ConflictException('DEPOSIT_PAYMENT_CONFLICT')
      }
      return agreement
    }
    if (agreement.status !== 'payment-pending') {
      throw new ConflictException('DEPOSIT_NOT_PAYMENT_PENDING')
    }
    agreement.status = 'paid'
    agreement.paidAt = receipt?.paidAt ?? new Date()
    agreement.paymentAttemptId = paymentAttemptId
    agreement.depositHash = depositHash || this.calculateDepositHash(agreement)
    agreement.receiptCode = receipt?.receiptCode ?? null
    agreement.receiptHash = receipt?.receiptHash ?? null
    agreement.ledgerStatus = 'pending'
    const saved = await this.repository.save(agreement)
    await this.recordTransactionEvent({
      agreement: saved,
      eventType: 'deposit.paid',
      actorRole: 'tenant',
      transitionKey: `deposit:${saved._id.toHexString()}:paid`,
      refs: { paymentId: paymentAttemptId },
    })
    await this.recordContractDepositPaidAt(saved)
    await this.enqueueDepositLedgerEvent(saved)
    await this.projectApartmentDepositPaid(saved)
    await this.activatePendingContract(saved)
    await this.notifyFlow(saved)
    return saved
  }

  async confirmDepositReceived(
    id: string,
    staffId: string,
    note: string
  ): Promise<DepositAgreement> {
    const agreement = await this.findById(id)
    if (agreement.status === 'paid') return agreement
    if (!['accepted', 'payment-pending'].includes(agreement.status)) {
      throw new ConflictException('DEPOSIT_NOT_CONFIRMABLE')
    }
    agreement.status = 'paid'
    agreement.paidAt = new Date()
    agreement.depositHash = this.calculateDepositHash(agreement)
    agreement.ledgerStatus = 'pending'
    agreement.manualConfirmation = {
      confirmedBy: staffId,
      confirmedAt: new Date(),
      note,
    }
    const saved = await this.repository.save(agreement)
    await this.recordTransactionEvent({
      agreement: saved,
      eventType: 'deposit.paid',
      actorRole: 'staff',
      actorId: staffId,
      transitionKey: `deposit:${saved._id.toHexString()}:paid`,
    })
    await this.recordContractDepositPaidAt(saved)
    await this.enqueueDepositLedgerEvent(saved)
    await this.projectApartmentDepositPaid(saved)
    await this.activatePendingContract(saved)
    await this.notifyFlow(saved)
    return saved
  }

  /** Thông báo stage hoàn tất; notifier tự nuốt lỗi và log cảnh báo. */
  private async notifyFlow(agreement: DepositAgreement): Promise<void> {
    await this.flowNotificationService?.notifyForDepositAgreement(
      agreement._id.toHexString()
    )
  }

  private async recordContractDepositPaidAt(
    agreement: DepositAgreement
  ): Promise<void> {
    if (!this.contractRepository || !agreement.paidAt) return

    // Mongo: `null` thay IsNull() (FindOperator không khớp null khi tuần tự hóa BSON)
    await this.contractRepository.update(
      {
        depositAgreementId: agreement._id.toHexString(),
        depositPaidAt: null as unknown as Date,
      },
      { depositPaidAt: agreement.paidAt }
    )
  }

  private async activatePendingContract(
    agreement: DepositAgreement
  ): Promise<void> {
    if (!this.contractsService) return
    try {
      await this.contractsService.activatePendingForDepositAgreement(
        agreement._id.toHexString()
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'ACTIVATION_FAILED'
      const code = message.split(':', 1)[0] || 'ACTIVATION_FAILED'
      if (this.contractRepository) {
        await this.contractRepository.update(
          { depositAgreementId: agreement._id.toHexString() },
          {
            activationFailure: {
              code,
              message: message.slice(0, 120),
              at: new Date(),
              attempts: 1,
            },
          }
        )
      }
      await this.recordTransactionEvent({
        agreement,
        eventType: 'contract.activation-failed',
        actorRole: 'system',
        reasonCode: message.slice(0, 120),
        transitionKey: `deposit:${agreement._id.toHexString()}:activation-failed`,
      })
    }
  }

  private async recordTransactionEvent(input: {
    agreement: DepositAgreement
    contractId?: string | null
    eventType: string
    actorRole: RentalTransactionActorRole
    actorId?: string | null
    reasonCode?: string | null
    refs?: Record<string, string>
    transitionKey: string
  }): Promise<void> {
    if (!this.transactionEventService) return
    const transactionKey =
      input.agreement.applicationId ?? input.agreement._id.toHexString()
    try {
      await this.transactionEventService.record({
        transactionKey,
        applicationId: input.agreement.applicationId ?? null,
        contractId:
          input.contractId ?? input.agreement.linkedLeaseContractId ?? null,
        eventType: input.eventType,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        reasonCode: input.reasonCode ?? null,
        refs: {
          depositAgreementId: input.agreement._id.toHexString(),
          ...(input.agreement.applicationId
            ? { applicationId: input.agreement.applicationId }
            : {}),
          ...(input.refs ?? {}),
        },
        transitionKey: input.transitionKey,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Rental transaction audit failed for deposit agreement [${input.agreement._id.toHexString()}] event [${input.eventType}]: ${message}`
      )
    }
  }

  private async projectApartmentDepositPaid(
    agreement: DepositAgreement
  ): Promise<void> {
    if (!this.apartmentRepository || !agreement.propertyId) return
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(agreement.propertyId) },
    })
    const reservation = apartment?.rentalReservation
    if (
      !apartment ||
      !reservation ||
      reservation.applicationId !== agreement.applicationId
    )
      return
    if (
      reservation.contractId ||
      (reservation.mode === 'deposit-paid' &&
        reservation.depositAgreementId !== agreement._id.toHexString())
    ) {
      return
    }
    if (
      reservation.mode === 'deposit-paid' &&
      reservation.depositAgreementId === agreement._id.toHexString()
    ) {
      return
    }
    reservation.mode = 'deposit-paid'
    reservation.depositAgreementId = agreement._id.toHexString()
    reservation.depositPaidAt = agreement.paidAt
    await this.apartmentRepository.save(apartment)
    await this.apartmentChangeNotifier?.changed()
  }

  private async releaseReservation(agreement: DepositAgreement): Promise<void> {
    if (!this.apartmentRepository || !agreement.propertyId) return
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(agreement.propertyId) },
    })
    const reservation = apartment?.rentalReservation
    if (
      !apartment ||
      !reservation ||
      reservation.applicationId !== agreement.applicationId ||
      reservation.contractId
    ) {
      return
    }

    const repositoryWithCas = this
      .apartmentRepository as Repository<Apartment> & {
      update?: Repository<Apartment>['update']
    }
    if (
      typeof repositoryWithCas.update === 'function' &&
      reservation.revision !== undefined
    ) {
      const result = await repositoryWithCas.update(
        {
          _id: apartment._id,
          'rentalReservation.applicationId': agreement.applicationId,
          'rentalReservation.revision': reservation.revision,
          'rentalReservation.contractId': null,
        } as unknown as FindOptionsWhere<Apartment>,
        { rentalReservation: null }
      )
      if (result.affected !== 1) return
      apartment.rentalReservation = null
      return
    }

    apartment.rentalReservation = null
    await this.apartmentRepository.save(apartment)
    await this.apartmentChangeNotifier?.changed()
  }

  private calculateDepositHash(agreement: DepositAgreement): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          agreementId: agreement._id.toString(),
          agreementCode: agreement.agreementCode,
          applicationId: agreement.applicationId,
          tenantId: agreement.tenantId,
          landlordId: agreement.landlordId,
          amount: agreement.amount,
          currency: 'VND',
        })
      )
      .digest('hex')
  }

  private async enqueueDepositLedgerEvent(
    agreement: DepositAgreement
  ): Promise<void> {
    if (!this.ledgerOutboxService || !agreement.depositHash) return

    await this.ledgerOutboxService.enqueue({
      aggregateType: 'deposit',
      aggregateId: agreement._id.toString(),
      eventType: 'deposit.paid',
      action: 'recordDeposit',
      args: [
        agreement._id.toString(),
        agreement._id.toString(),
        agreement.linkedLeaseContractId ?? agreement.applicationId ?? 'none',
        (agreement.amount ?? 0).toString(),
        agreement.depositHash,
      ],

      metadata: {
        agreementId: agreement._id.toString(),
        applicationId: agreement.applicationId,
        contractId: agreement.linkedLeaseContractId ?? undefined,
      },
    })
  }

  async linkToLease(
    id: string,
    contractId: string,
    contractHash: string
  ): Promise<DepositAgreement> {
    const agreement = await this.findById(id)
    if (agreement.status === 'applied-to-lease-security') {
      if (
        agreement.linkedLeaseContractId !== contractId ||
        agreement.linkedLeaseContractHash !== contractHash
      ) {
        throw new ConflictException('DEPOSIT_LEASE_LINK_CONFLICT')
      }
      return agreement
    }
    if (agreement.status !== 'paid') {
      throw new ConflictException('DEPOSIT_NOT_PAID')
    }
    agreement.status = 'applied-to-lease-security'
    agreement.linkedLeaseContractId = contractId
    agreement.linkedLeaseContractHash = contractHash
    return this.repository.save(agreement)
  }

  private async findById(id: string): Promise<DepositAgreement> {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('DEPOSIT_AGREEMENT_NOT_FOUND')
    const agreement = await this.repository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!agreement) throw new NotFoundException('DEPOSIT_AGREEMENT_NOT_FOUND')
    return agreement
  }

  private assertTenant(agreement: DepositAgreement, tenantId: string): void {
    if (agreement.tenantId !== tenantId)
      throw new ForbiddenException('DEPOSIT_ACCESS_DENIED')
  }
}
