import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { MAX_CUSTOM_CLAUSES_LENGTH } from '../legal/lease-compliance.validator'
import { withContractExtras } from '../commercial/resolve-effective-commercial'
import {
  isValidOccupantList,
  isValidUtilityRates,
} from '../utils/amendment-field-validators.util'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import {
  Contract,
  type ContractCommercialDraft,
  type ContractSignature,
} from '../schemas/contract.schema'
import {
  ContractAmendment,
  type ContractAmendmentChange,
} from '../schemas/contract-amendment.schema'
import { Payment } from '../../payments/schemas/payment.schema'
import { PaymentsService } from '../../payments/services/payments.service'
import { LedgerOutboxService } from '../../fabric/services/ledger-outbox.service'
import { ContractArtifactService } from './contract-artifact.service'
import { ContractAmendmentStore } from './contract-amendment.store'

const AMENDABLE_FIELDS = new Set<keyof ContractCommercialDraft>([
  'monthlyRent',
  'deposit',
  'paymentDay',
  'latePenaltyRate',
  'terminationNoticeDays',
  'durationMonths',
  'utilities',
  'handoverNotes',
  'inventoryReference',
  'noticePeriodDays',
  'addendaIds',
  'occupants',
  'utilityRates',
  'customClauses',
])

type AmendmentActor = {
  actorId: string
  isStaff: boolean
  role?: 'tenant' | 'landlord'
}

@Injectable()
export class ContractAmendmentService {
  constructor(
    // Phụ lục nhúng trong `Contract.amendments[]` (G-AMD), cùng dáng API repository cũ.
    private readonly amendmentRepository: ContractAmendmentStore,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @Optional() private readonly paymentsService?: PaymentsService,
    @Optional() private readonly ledgerOutboxService?: LedgerOutboxService,
    @Optional() private readonly artifactService?: ContractArtifactService
  ) {}

  async resolveParticipantRole(
    contractId: string,
    actorId: string
  ): Promise<'tenant' | 'landlord' | undefined> {
    const contract = await this.findContract(contractId)
    if (contract.landlordId === actorId) return 'landlord'
    if (contract.tenantId === actorId) return 'tenant'
    return undefined
  }

  async create(
    contractId: string,
    input: {
      changes: Array<{ field: string; after: unknown }>
      effectiveFrom: string
      idempotencyKey?: string
    },
    actor: AmendmentActor
  ): Promise<ContractAmendment> {
    const contract = await this.findContract(contractId)
    this.assertStaffOrParticipant(contract, actor, true)
    if (
      ['terminated', 'cancelled', 'completed'].includes(contract.status ?? '')
    ) {
      throw new ConflictException('CONTRACT_AMENDMENT_STATE_CLOSED')
    }
    if (!actor.isStaff && !this.isContentLocked(contract)) {
      throw new ConflictException('CONTRACT_AMENDMENT_USE_CHANGE_REQUEST')
    }
    if (input.idempotencyKey) {
      const existing = await this.amendmentRepository.findOne({
        where: { contractId, idempotencyKey: input.idempotencyKey },
      })
      if (existing) return existing
    }
    const openAmendment = await this.amendmentRepository.findOne({
      where: [
        { contractId, status: 'draft' },
        { contractId, status: 'in-review' },
        { contractId, status: 'locked' },
        { contractId, status: 'pending-signature' },
      ],
    })
    if (openAmendment)
      throw new ConflictException('CONTRACT_AMENDMENT_IN_PROGRESS')
    const effectiveFrom = this.parseFutureDate(input.effectiveFrom)
    const beforeSnapshot = this.currentCommercial(contract)
    const afterSnapshot = this.applyChanges(beforeSnapshot, input.changes)
    const changes = this.toChanges(beforeSnapshot, afterSnapshot)
    if (changes.length === 0)
      throw new BadRequestException('CONTRACT_AMENDMENT_NO_CHANGE')
    const latest = await this.latest(contractId)
    const predecessor = await this.latestEffective(contractId)
    const amendment = this.amendmentRepository.create({
      contractId,
      sequence: (latest?.sequence ?? 0) + 1,
      status: 'draft',
      revision: 0,
      changes,
      beforeSnapshot,
      afterSnapshot,
      effectiveFrom,
      predecessorId: predecessor?._id.toHexString() ?? null,
      contentHash: this.hash({
        contractId,
        sequence: (latest?.sequence ?? 0) + 1,
        changes,
        effectiveFrom: effectiveFrom.toISOString(),
      }),
      idempotencyKey: input.idempotencyKey ?? null,
      createdBy: actor.actorId,
      ledgerStatus: 'not-requested',
    })
    return this.amendmentRepository.save(amendment)
  }

  async list(
    contractId: string,
    actor: AmendmentActor
  ): Promise<ContractAmendment[]> {
    const contract = await this.findContract(contractId)
    this.assertStaffOrParticipant(contract, actor, false)
    await this.applyDueAmendments(contract)
    return this.amendmentRepository.find({
      where: { contractId },
      order: { sequence: 'ASC' },
      omitSnapshots: true,
    })
  }

  async get(
    contractId: string,
    amendmentId: string,
    actor: AmendmentActor
  ): Promise<ContractAmendment> {
    const contract = await this.findContract(contractId)
    this.assertStaffOrParticipant(contract, actor, false)
    if (!ObjectId.isValid(amendmentId))
      throw new NotFoundException('CONTRACT_AMENDMENT_NOT_FOUND')
    const amendment = await this.amendmentRepository.findOne({
      where: { _id: new ObjectId(amendmentId), contractId },
    })
    if (!amendment) throw new NotFoundException('CONTRACT_AMENDMENT_NOT_FOUND')
    return amendment
  }

  async update(
    contractId: string,
    amendmentId: string,
    input: {
      changes: Array<{ field: string; after: unknown }>
      effectiveFrom: string
      expectedRevision: number
    },
    actor: AmendmentActor
  ): Promise<ContractAmendment> {
    const amendment = await this.get(contractId, amendmentId, actor)
    this.assertStaffOrParticipant(
      await this.findContract(contractId),
      actor,
      true
    )
    if (amendment.status !== 'draft' && amendment.status !== 'in-review')
      throw new ConflictException('CONTRACT_AMENDMENT_NOT_EDITABLE')
    if (amendment.revision !== input.expectedRevision)
      throw new ConflictException('CONTRACT_AMENDMENT_REVISION_STALE')
    const effectiveFrom = this.parseFutureDate(input.effectiveFrom)
    const afterSnapshot = this.applyChanges(
      amendment.beforeSnapshot,
      input.changes
    )
    const changes = this.toChanges(amendment.beforeSnapshot, afterSnapshot)
    if (changes.length === 0)
      throw new BadRequestException('CONTRACT_AMENDMENT_NO_CHANGE')
    amendment.changes = changes
    amendment.afterSnapshot = afterSnapshot
    amendment.effectiveFrom = effectiveFrom
    amendment.contentHash = this.hash({
      contractId,
      sequence: amendment.sequence,
      changes,
      effectiveFrom: effectiveFrom.toISOString(),
    })
    amendment.revision += 1
    return this.amendmentRepository.save(amendment)
  }

  async lock(
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
    actor: AmendmentActor
  ): Promise<ContractAmendment> {
    const amendment = await this.get(contractId, amendmentId, actor)
    this.assertStaffOrParticipant(
      await this.findContract(contractId),
      actor,
      true
    )
    if (!['draft', 'in-review'].includes(amendment.status))
      throw new ConflictException('CONTRACT_AMENDMENT_NOT_LOCKABLE')
    if (amendment.revision !== expectedRevision)
      throw new ConflictException('CONTRACT_AMENDMENT_REVISION_STALE')
    amendment.status = 'locked'
    amendment.lockedAt = new Date()
    amendment.revision += 1
    return this.amendmentRepository.save(amendment)
  }

  async lockArtifact(
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
    bytes: Buffer,
    actor: AmendmentActor
  ): Promise<ContractAmendment> {
    const amendment = await this.get(contractId, amendmentId, actor)
    this.assertStaffOrParticipant(
      await this.findContract(contractId),
      actor,
      true
    )
    if (amendment.status !== 'locked') {
      throw new ConflictException('CONTRACT_AMENDMENT_ARTIFACT_NOT_LOCKABLE')
    }
    if (amendment.revision !== expectedRevision) {
      throw new ConflictException('CONTRACT_AMENDMENT_REVISION_STALE')
    }
    if (!this.artifactService) {
      throw new ConflictException(
        'CONTRACT_AMENDMENT_ARTIFACT_SERVICE_UNAVAILABLE'
      )
    }
    return this.artifactService.lockAmendmentArtifact(
      contractId,
      amendmentId,
      actor.actorId,
      actor.isStaff,
      bytes
    )
  }

  async resolveArtifact(
    contractId: string,
    amendmentId: string,
    actor: AmendmentActor
  ): Promise<{ bytes: Buffer; artifactHash: string; revision: number }> {
    if (!this.artifactService) {
      throw new ConflictException(
        'CONTRACT_AMENDMENT_ARTIFACT_SERVICE_UNAVAILABLE'
      )
    }
    return this.artifactService.resolveAmendmentArtifact(
      contractId,
      amendmentId,
      actor.actorId,
      actor.isStaff
    )
  }

  async sign(
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
    signatureHash: string,
    actor: AmendmentActor
  ): Promise<ContractAmendment> {
    const contract = await this.findContract(contractId)
    const amendment = await this.get(contractId, amendmentId, actor)
    if (!actor.role || !['tenant', 'landlord'].includes(actor.role))
      throw new ForbiddenException('CONTRACT_AMENDMENT_SIGN_ACCESS_DENIED')
    const existingSignature =
      actor.role === 'tenant'
        ? amendment.tenantSignature
        : amendment.landlordSignature
    if (
      existingSignature?.artifactHash &&
      existingSignature.artifactHash === amendment.artifactHash
    ) {
      return amendment
    }
    if (amendment.status !== 'pending-signature')
      throw new ConflictException('CONTRACT_AMENDMENT_NOT_SIGNABLE')
    if (amendment.revision !== expectedRevision)
      throw new ConflictException('CONTRACT_AMENDMENT_REVISION_STALE')
    if (!amendment.artifactHash || !amendment.artifactRef) {
      throw new ConflictException('CONTRACT_AMENDMENT_ARTIFACT_NOT_AVAILABLE')
    }
    if (signatureHash !== amendment.artifactHash)
      throw new ConflictException(
        'CONTRACT_AMENDMENT_SIGNATURE_DIGEST_MISMATCH'
      )
    const signature: ContractSignature = {
      signerId: actor.actorId,
      role: actor.role,
      signedAt: new Date(),
      contentHash: amendment.contentHash ?? '',
      artifactHash: amendment.artifactHash ?? null,
      providerStatus: 'signed',
    }
    if (actor.role === 'tenant') amendment.tenantSignature = signature
    else amendment.landlordSignature = signature
    amendment.revision += 1
    if (amendment.tenantSignature && amendment.landlordSignature) {
      amendment.status = 'effective'
      await this.activateAmendment(contract, amendment)
    }
    return this.amendmentRepository.save(amendment)
  }

  async reject(
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
    actor: AmendmentActor
  ): Promise<ContractAmendment> {
    const amendment = await this.get(contractId, amendmentId, actor)
    this.assertStaffOrParticipant(
      await this.findContract(contractId),
      actor,
      false
    )
    if (!['pending-signature', 'in-review'].includes(amendment.status))
      throw new ConflictException('CONTRACT_AMENDMENT_NOT_REJECTABLE')
    if (amendment.revision !== expectedRevision)
      throw new ConflictException('CONTRACT_AMENDMENT_REVISION_STALE')
    amendment.status = 'rejected'
    amendment.rejectedAt = new Date()
    amendment.revision += 1
    return this.amendmentRepository.save(amendment)
  }

  async cancel(
    contractId: string,
    amendmentId: string,
    expectedRevision: number,
    actor: AmendmentActor
  ): Promise<ContractAmendment> {
    const amendment = await this.get(contractId, amendmentId, actor)
    this.assertStaffOrParticipant(
      await this.findContract(contractId),
      actor,
      true
    )
    if (
      ['effective', 'superseded', 'rejected', 'cancelled'].includes(
        amendment.status
      )
    )
      return amendment
    if (amendment.revision !== expectedRevision)
      throw new ConflictException('CONTRACT_AMENDMENT_REVISION_STALE')
    amendment.status = 'cancelled'
    amendment.cancelledAt = new Date()
    amendment.revision += 1
    return this.amendmentRepository.save(amendment)
  }

  private async activateAmendment(
    contract: Contract,
    amendment: ContractAmendment
  ): Promise<void> {
    const prior = await this.amendmentRepository.find({
      where: { contractId: contract._id.toHexString(), status: 'effective' },
    })
    for (const item of prior) {
      if (
        item._id.toHexString() !== amendment._id.toHexString() &&
        item.sequence < amendment.sequence
      ) {
        item.status = 'superseded'
        await this.amendmentRepository.save(item)
      }
    }
    if (amendment.effectiveFrom.getTime() > Date.now()) return
    this.applyCommercial(contract, amendment.afterSnapshot)
    contract.governingAmendmentId = amendment._id.toHexString()
    await this.contractRepository.save(contract)
    await this.updateFuturePayments(contract, amendment)
    amendment.projectionAppliedAt = new Date()
  }

  /**
   * Sweep vận hành (D10): áp dụng mọi phụ lục `effective` đã tới ngày hiệu
   * lực trên toàn bộ hợp đồng, thay vì chỉ lười áp dụng khi `list()` được
   * gọi cho một hợp đồng cụ thể. Tái sử dụng `applyDueAmendments(contract)`
   * hiện có cho từng hợp đồng nên không trùng lặp nghiệp vụ.
   */
  async applyAllDueAmendments(now = new Date()): Promise<number> {
    const dueAmendments = await this.amendmentRepository.find({
      where: { status: 'effective' },
      omitSnapshots: true,
    })
    const contractIds = new Set(
      dueAmendments
        .filter(
          amendment =>
            !amendment.projectionAppliedAt &&
            amendment.effectiveFrom.getTime() <= now.getTime()
        )
        .map(amendment => amendment.contractId)
    )
    let processed = 0
    for (const contractId of contractIds) {
      if (!ObjectId.isValid(contractId)) continue
      const contract = await this.contractRepository.findOne({
        where: { _id: new ObjectId(contractId) },
      })
      if (!contract) continue
      await this.applyDueAmendments(contract)
      processed += 1
    }
    return processed
  }

  private async applyDueAmendments(contract: Contract): Promise<void> {
    const amendments = await this.amendmentRepository.find({
      where: { contractId: contract._id.toHexString(), status: 'effective' },
      order: { sequence: 'ASC' },
    })
    let changed = false
    for (const amendment of amendments) {
      if (amendment.effectiveFrom.getTime() > Date.now()) continue
      if (amendment.projectionAppliedAt) continue
      this.applyCommercial(contract, amendment.afterSnapshot)
      contract.governingAmendmentId = amendment._id.toHexString()
      await this.updateFuturePayments(contract, amendment)
      amendment.projectionAppliedAt = new Date()
      await this.amendmentRepository.save(amendment)
      changed = true
    }
    if (changed) await this.contractRepository.save(contract)
  }

  private async updateFuturePayments(
    contract: Contract,
    amendment: ContractAmendment
  ): Promise<void> {
    const monthlyRent = amendment.afterSnapshot.monthlyRent
    const payments = await this.paymentRepository.find({
      where: { contractId: contract._id.toHexString(), type: 'rent' },
    })
    for (const payment of payments) {
      if (
        payment.status === 'paid' ||
        payment.dueDate.getTime() < amendment.effectiveFrom.getTime()
      )
        continue
      payment.amount = monthlyRent
      payment.description = `Rent ${payment.periodKey ?? ''}`.trim()
      payment.governingAmendmentId = amendment._id.toHexString()
      payment.governingAmendmentHash = amendment.contentHash ?? null
      await this.paymentRepository.save(payment)
    }
    if (this.paymentsService)
      await this.paymentsService.generateSchedule(contract)
    if (this.ledgerOutboxService && amendment.contentHash) {
      amendment.ledgerStatus = 'pending'
      await this.ledgerOutboxService.enqueue({
        aggregateType: 'contract-amendment',
        aggregateId: amendment._id.toHexString(),
        eventType: 'contract.amendment-effective',
        action: 'recordContractAmendment',
        args: [contract._id.toHexString(), amendment.contentHash],
        metadata: {
          contractId: contract._id.toHexString(),
          amendmentId: amendment._id.toHexString(),
          sequence: amendment.sequence,
          effectiveFrom: amendment.effectiveFrom.toISOString(),
          predecessorId: amendment.predecessorId,
          minimumAbiVersion: 2,
          waitingCode: 'CHAINCODE_UPGRADE_REQUIRED',
          details: { contentHash: amendment.contentHash },
        },
      })
    }
  }

  private applyCommercial(
    contract: Contract,
    draft: ContractCommercialDraft
  ): void {
    contract.effectiveCommercial = JSON.parse(
      JSON.stringify(draft)
    ) as ContractCommercialDraft
    contract.effectiveCommercialRevision =
      (contract.effectiveCommercialRevision ?? 0) + 1
  }

  private currentCommercial(contract: Contract): ContractCommercialDraft {
    return withContractExtras(
      contract,
      contract.effectiveCommercial ??
        contract.commercialDraft ?? {
          monthlyRent: contract.monthlyRent,
          deposit: contract.deposit,
          paymentDay: contract.paymentDay,
          latePenaltyRate: contract.latePenaltyRate,
          terminationNoticeDays: contract.terminationNoticeDays,
          durationMonths: contract.durationMonths ?? 12,
          ...(contract.customClauses
            ? { customClauses: contract.customClauses }
            : {}),
        }
    )
  }

  private applyChanges(
    before: ContractCommercialDraft,
    changes: Array<{ field: string; after: unknown }>
  ): ContractCommercialDraft {
    const next = JSON.parse(JSON.stringify(before)) as ContractCommercialDraft
    for (const change of changes) {
      if (!AMENDABLE_FIELDS.has(change.field as keyof ContractCommercialDraft))
        throw new BadRequestException('CONTRACT_AMENDMENT_FIELD_NOT_ALLOWED')
      if (change.after === undefined)
        throw new BadRequestException('CONTRACT_AMENDMENT_VALUE_REQUIRED')
      if (change.field === 'occupants' && !isValidOccupantList(change.after))
        throw new BadRequestException('CONTRACT_AMENDMENT_OCCUPANTS_INVALID')
      if (change.field === 'utilityRates' && !isValidUtilityRates(change.after))
        throw new BadRequestException(
          'CONTRACT_AMENDMENT_UTILITY_RATES_INVALID'
        )
      next[change.field as keyof ContractCommercialDraft] =
        change.after as never
    }
    const clauses = next.customClauses
    if (
      clauses != null &&
      (typeof clauses !== 'string' ||
        clauses.length > MAX_CUSTOM_CLAUSES_LENGTH)
    )
      throw new BadRequestException('CONTRACT_AMENDMENT_FIELD_NOT_ALLOWED')
    return next
  }

  private toChanges(
    before: ContractCommercialDraft,
    after: ContractCommercialDraft
  ): ContractAmendmentChange[] {
    return [...AMENDABLE_FIELDS]
      .filter(
        field => JSON.stringify(before[field]) !== JSON.stringify(after[field])
      )
      .map(field => ({ field, before: before[field], after: after[field] }))
  }

  private parseFutureDate(value: string): Date {
    const date = new Date(value)
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now())
      throw new BadRequestException('CONTRACT_AMENDMENT_EFFECTIVE_DATE_INVALID')
    return date
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
  }

  private async latest(contractId: string): Promise<ContractAmendment | null> {
    const items = await this.amendmentRepository.find({
      where: { contractId },
      order: { sequence: 'DESC' },
    })
    return items[0] ?? null
  }

  private async latestEffective(
    contractId: string
  ): Promise<ContractAmendment | null> {
    const items = await this.amendmentRepository.find({
      where: { contractId, status: 'effective' },
      order: { sequence: 'DESC' },
    })
    return items[0] ?? null
  }

  private async findContract(contractId: string): Promise<Contract> {
    if (!ObjectId.isValid(contractId))
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')
    return contract
  }

  /** Hợp đồng nháp chưa khóa đi qua yêu cầu chỉnh sửa, chỉ hợp đồng đã khóa hoặc đã ký mới có phụ lục. */
  private isContentLocked(contract: Contract): boolean {
    return Boolean(
      contract.contentLockedHash ||
      contract.contentLockedAt ||
      contract.status === 'active'
    )
  }

  private assertStaffOrParticipant(
    contract: Contract,
    actor: AmendmentActor,
    mutation: boolean
  ): void {
    if (actor.isStaff) return
    if (mutation && actor.role !== 'tenant' && actor.role !== 'landlord')
      throw new ForbiddenException('CONTRACT_AMENDMENT_ACCESS_DENIED')
    if (
      actor.actorId !== contract.tenantId &&
      actor.actorId !== contract.landlordId
    )
      throw new ForbiddenException('CONTRACT_AMENDMENT_ACCESS_DENIED')
  }
}
