import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { createHash } from 'node:crypto'
import { IsNull, Repository } from 'typeorm'
import type { FindOptionsWhere } from 'typeorm'
import type { RentalPackageSnapshot } from '../apartments/rental-package.util'
import type { RentalExecutionPolicyRef } from '../rental-flow-config/rental-execution-policy.util'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { validateDepositConsent } from './deposit-consent.util'
import { Contract } from './schemas/contract.schema'
import { DepositAgreement } from './schemas/deposit-agreement.schema'
import { LedgerOutboxService } from '../fabric/ledger-outbox.service'
import { ContractsService } from './contracts.service'
import { OwnershipTransferResolver } from '../property-ownership-transfer/ownership-transfer.resolver'

@Injectable()
export class DepositAgreementsService {
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
    private readonly contractRepository?: Repository<Contract>
  ) {}

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
    const contentHash = createHash('sha256')
      .update(
        JSON.stringify({
          agreementCode,
          applicationId: input.applicationId,
          packageSnapshot: input.packageSnapshot,
          purpose: 'SECURE_CONCLUSION_THEN_PERFORMANCE',
          templateVersion: 'deposit-v1',
        })
      )
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
      amount: input.packageSnapshot.resolvedDepositAmount,
      templateVersion: 'deposit-v1',
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
    return this.repository.save(agreement)
  }

  async markPaymentPending(
    id: string,
    tenantId: string
  ): Promise<DepositAgreement> {
    const agreement = await this.findById(id)
    this.assertTenant(agreement, tenantId)
    if (agreement.status !== 'accepted' || !agreement.tenantConsent) {
      throw new ConflictException('DEPOSIT_CONSENT_REQUIRED')
    }
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
    await this.releaseReservation(saved)
    return saved
  }

  async recordDepositPaid(
    id: string,
    paymentAttemptId: string,
    depositHash?: string
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
    agreement.paidAt = new Date()
    agreement.paymentAttemptId = paymentAttemptId
    agreement.depositHash = depositHash || this.calculateDepositHash(agreement)
    agreement.ledgerStatus = 'pending'
    const saved = await this.repository.save(agreement)
    await this.recordContractDepositPaidAt(saved)
    await this.enqueueDepositLedgerEvent(saved)
    await this.projectApartmentDepositPaid(saved)
    await this.activatePendingContract(saved)
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
    await this.recordContractDepositPaidAt(saved)
    await this.enqueueDepositLedgerEvent(saved)
    await this.projectApartmentDepositPaid(saved)
    await this.activatePendingContract(saved)
    return saved
  }

  private async recordContractDepositPaidAt(
    agreement: DepositAgreement
  ): Promise<void> {
    if (!this.contractRepository || !agreement.paidAt) return

    await this.contractRepository.update(
      {
        depositAgreementId: agreement._id.toHexString(),
        depositPaidAt: IsNull(),
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
      if (!this.contractRepository) return
      const message =
        error instanceof Error ? error.message : 'ACTIVATION_FAILED'
      const code = message.split(':', 1)[0] || 'ACTIVATION_FAILED'
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
