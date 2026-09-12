import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { createHash } from 'node:crypto'
import { Repository } from 'typeorm'
import type { RentalPackageSnapshot } from '../apartments/rental-package.util'
import { validateDepositConsent } from './deposit-consent.util'
import { DepositAgreement } from './schemas/deposit-agreement.schema'

@Injectable()
export class DepositAgreementsService {
  constructor(
    @InjectRepository(DepositAgreement)
    private readonly repository: Repository<DepositAgreement>
  ) {}

  async createFromApplicationSnapshot(input: {
    applicationId: string
    tenantId: string
    landlordId: string
    packageSnapshot: RentalPackageSnapshot
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
      tenantId: input.tenantId,
      landlordId: input.landlordId,
      packageSnapshot: input.packageSnapshot,
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

  async getAgreement(
    id: string,
    actorId: string,
    isStaff: boolean
  ): Promise<DepositAgreement> {
    const agreement = await this.findById(id)
    if (
      !isStaff &&
      agreement.tenantId !== actorId &&
      agreement.landlordId !== actorId
    ) {
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
    agreement.depositHash = depositHash ?? null
    return this.repository.save(agreement)
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
    agreement.manualConfirmation = {
      confirmedBy: staffId,
      confirmedAt: new Date(),
      note,
    }
    return this.repository.save(agreement)
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
