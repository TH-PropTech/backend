import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { PoliciesService } from '../../legal/services/policies.service'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { CONSENT_REQUIRED_FIELDS } from '../commercial/resolve-consented-terms'
import {
  loadLeaseComplianceLimits,
  validateLeaseCompliance,
} from '../legal/lease-compliance.validator'
import type {
  ContractCommercialAuditEvent,
  ContractCommercialDraft,
} from '../schemas/contract.schema'
import { Contract } from '../schemas/contract.schema'
import {
  ContractChangeRequest,
  type ContractChangeRequestRole,
} from '../schemas/contract-change-request.schema'
import {
  applyChangeRequest,
  CHANGE_REQUEST_TTL_DAYS,
  diffCommercial,
  hashCommercial,
} from '../utils/contract-change-request.util'
import { DepositAgreementsService } from './deposit-agreements.service'

export type ChangeRequestActor = {
  actorId: string
  isStaff: boolean
}

export type ChangeRequestListView = {
  commercialRevision: number
  locked: boolean
  items: ContractChangeRequest[]
}

export type CreateChangeRequestInput = {
  changes: Array<{ field: string; after: unknown }>
  reason: string
  expectedRevision: number
  idempotencyKey?: string | undefined
}

const DAY_MS = 24 * 60 * 60 * 1000
const CLOSED_CONTRACT_STATUSES = [
  'active',
  'terminated',
  'completed',
  'cancelled',
]

@Injectable()
export class ContractChangeRequestService {
  private readonly logger = new Logger(ContractChangeRequestService.name)

  constructor(
    @InjectRepository(ContractChangeRequest)
    private readonly requests: Repository<ContractChangeRequest>,
    @InjectRepository(Contract)
    private readonly contracts: Repository<Contract>,
    @Optional() private readonly policiesService?: PoliciesService,
    @Optional() private readonly notificationsService?: NotificationsService,
    @Optional()
    private readonly depositAgreementsService?: DepositAgreementsService
  ) {}

  async create(
    contractId: string,
    input: CreateChangeRequestInput,
    actor: ChangeRequestActor
  ): Promise<ContractChangeRequest> {
    const contract = await this.findContract(contractId)
    const role = this.participantRole(contract, actor.actorId)
    this.assertEditable(contract)
    if (input.idempotencyKey) {
      const repeated = await this.requests.findOne({
        where: { contractId, idempotencyKey: input.idempotencyKey },
      })
      if (repeated) return repeated
    }
    await this.assertNoOpenRequest(contractId)
    if ((contract.commercialRevision ?? 0) !== input.expectedRevision)
      throw new ConflictException('CONTRACT_REVISION_STALE')

    const before = this.currentCommercial(contract)
    const after = applyChangeRequest(before, input.changes)
    const changes = diffCommercial(before, after)
    if (changes.length === 0)
      throw new BadRequestException('CONTRACT_CHANGE_REQUEST_NO_CHANGE')
    await this.assertLegal(after, contract)

    const latest = await this.requests.find({
      where: { contractId },
      order: { sequence: 'DESC' },
      take: 1,
    })
    const request = this.requests.create({
      contractId,
      sequence: (latest[0]?.sequence ?? 0) + 1,
      status: 'pending-counterparty',
      requestedBy: actor.actorId,
      requestedRole: role,
      changes,
      reason: input.reason,
      baseRevision: contract.commercialRevision ?? 0,
      idempotencyKey: input.idempotencyKey ?? null,
      expiresAt: new Date(Date.now() + CHANGE_REQUEST_TTL_DAYS * DAY_MS),
      auditHashes: {
        beforeHash: hashCommercial(before),
        afterHash: hashCommercial(after),
      },
    })
    const saved = await this.requests.save(request)
    await this.notify(
      this.counterpartyId(contract, role),
      'Có yêu cầu chỉnh sửa hợp đồng',
      'Một bên đề nghị chỉnh sửa điều khoản hợp đồng nháp và đang chờ bạn phản hồi.',
      saved
    )
    return saved
  }

  async list(
    contractId: string,
    actor: ChangeRequestActor
  ): Promise<ChangeRequestListView> {
    const contract = await this.findContract(contractId)
    if (!actor.isStaff) this.participantRole(contract, actor.actorId)
    const found = await this.requests.find({
      where: { contractId },
      order: { sequence: 'DESC' },
    })
    return {
      commercialRevision: contract.commercialRevision ?? 0,
      locked: this.isClosed(contract),
      items: await Promise.all(found.map(item => this.expireIfDue(item))),
    }
  }

  async accept(
    contractId: string,
    requestId: string,
    actor: ChangeRequestActor
  ): Promise<ContractChangeRequest> {
    const contract = await this.findContract(contractId)
    this.participantRole(contract, actor.actorId)
    const request = await this.findPending(contractId, requestId)
    if (request.requestedBy === actor.actorId)
      throw new ForbiddenException('CONTRACT_CHANGE_REQUEST_SELF_DECISION')
    this.assertEditable(contract)
    if ((contract.commercialRevision ?? 0) !== request.baseRevision)
      throw new ConflictException('CONTRACT_REVISION_STALE')

    const before = this.currentCommercial(contract)
    const after = applyChangeRequest(before, request.changes)
    await this.assertLegal(after, contract)
    await this.applyToContract(contract, request, before, after, actor.actorId)

    request.status = 'applied'
    request.decidedBy = actor.actorId
    request.decidedAt = new Date()
    const saved = await this.requests.save(request)
    await this.notify(
      request.requestedBy,
      'Yêu cầu chỉnh sửa hợp đồng đã được chấp nhận',
      'Bên còn lại đã đồng ý, hợp đồng nháp đã được cập nhật.',
      saved
    )
    return saved
  }

  async reject(
    contractId: string,
    requestId: string,
    reason: string,
    actor: ChangeRequestActor
  ): Promise<ContractChangeRequest> {
    const contract = await this.findContract(contractId)
    if (!actor.isStaff) this.participantRole(contract, actor.actorId)
    const request = await this.findPending(contractId, requestId)
    if (!actor.isStaff && request.requestedBy === actor.actorId)
      throw new ForbiddenException('CONTRACT_CHANGE_REQUEST_SELF_DECISION')
    return this.close(request, 'rejected', reason, actor.actorId, contract)
  }

  async cancel(
    contractId: string,
    requestId: string,
    reason: string,
    actor: ChangeRequestActor
  ): Promise<ContractChangeRequest> {
    const contract = await this.findContract(contractId)
    if (!actor.isStaff) this.participantRole(contract, actor.actorId)
    const request = await this.findPending(contractId, requestId)
    if (!actor.isStaff && request.requestedBy !== actor.actorId)
      throw new ForbiddenException('CONTRACT_CHANGE_REQUEST_ACCESS_DENIED')
    return this.close(request, 'cancelled', reason, actor.actorId, contract)
  }

  private async close(
    request: ContractChangeRequest,
    status: 'rejected' | 'cancelled',
    reason: string,
    actorId: string,
    contract: Contract
  ): Promise<ContractChangeRequest> {
    request.status = status
    request.decidedBy = actorId
    request.decidedAt = new Date()
    request.decisionReason = reason
    const saved = await this.requests.save(request)
    const recipients = [contract.landlordId, contract.tenantId].filter(
      id => id !== actorId
    )
    await Promise.all(
      recipients.map(id =>
        this.notify(
          id,
          status === 'rejected'
            ? 'Yêu cầu chỉnh sửa hợp đồng bị từ chối'
            : 'Yêu cầu chỉnh sửa hợp đồng đã đóng',
          reason,
          saved
        )
      )
    )
    return saved
  }

  private async applyToContract(
    contract: Contract,
    request: ContractChangeRequest,
    before: ContractCommercialDraft,
    after: ContractCommercialDraft,
    actorId: string
  ): Promise<void> {
    if (
      after.deposit !== before.deposit &&
      contract.depositAgreementId &&
      this.depositAgreementsService
    ) {
      await this.depositAgreementsService.reviseSecurityDepositBeforeConsent(
        contract.depositAgreementId,
        after.deposit
      )
    }
    const revision = (contract.commercialRevision ?? 0) + 1
    const event: ContractCommercialAuditEvent = {
      actorId,
      revision,
      changedFields: request.changes.map(change => change.field),
      beforeHash: hashCommercial(before),
      afterHash: hashCommercial(after),
      createdAt: new Date(),
    }
    contract.commercialDraft = after
    contract.commercialRevision = revision
    contract.commercialAudit = [...(contract.commercialAudit ?? []), event]
    if (request.changes.some(change => change.field === 'customClauses'))
      contract.customClauses = after.customClauses ?? null
    if (
      request.changes.some(change =>
        (CONSENT_REQUIRED_FIELDS as readonly string[]).includes(change.field)
      )
    ) {
      contract.consentedTerms = {
        monthlyRent: after.monthlyRent,
        deposit: after.deposit,
        durationMonths: after.durationMonths,
      }
    }
    await this.contracts.save(contract)
  }

  private currentCommercial(contract: Contract): ContractCommercialDraft {
    return (
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

  private async assertLegal(
    after: ContractCommercialDraft,
    contract: Contract
  ): Promise<void> {
    const violations = validateLeaseCompliance(
      {
        latePenaltyRate: after.latePenaltyRate,
        terminationNoticeDays: after.terminationNoticeDays,
        deposit: after.deposit,
        propertyValue: contract.propertyValue,
      },
      this.policiesService
        ? await loadLeaseComplianceLimits(this.policiesService)
        : undefined
    )
    if (violations.length > 0)
      throw new BadRequestException({
        message: 'CONTRACT_CHANGE_REQUEST_VIOLATES_LAW',
        violations,
      })
  }

  private isClosed(contract: Contract): boolean {
    return (
      Boolean(contract.contentLockedHash || contract.contentLockedAt) ||
      CLOSED_CONTRACT_STATUSES.includes(contract.status ?? '')
    )
  }

  private assertEditable(contract: Contract): void {
    if (this.isClosed(contract))
      throw new ConflictException('CONTRACT_CONTENT_LOCKED')
  }

  private async assertNoOpenRequest(contractId: string): Promise<void> {
    const open = await this.requests.find({
      where: { contractId, status: 'pending-counterparty' },
    })
    const stillOpen = (
      await Promise.all(open.map(item => this.expireIfDue(item)))
    ).some(item => item.status === 'pending-counterparty')
    if (stillOpen)
      throw new ConflictException('CONTRACT_CHANGE_REQUEST_IN_PROGRESS')
  }

  private async findPending(
    contractId: string,
    requestId: string
  ): Promise<ContractChangeRequest> {
    if (!ObjectId.isValid(requestId))
      throw new NotFoundException('CONTRACT_CHANGE_REQUEST_NOT_FOUND')
    const found = await this.requests.findOne({
      where: { _id: new ObjectId(requestId), contractId },
    })
    if (!found) throw new NotFoundException('CONTRACT_CHANGE_REQUEST_NOT_FOUND')
    const request = await this.expireIfDue(found)
    if (request.status !== 'pending-counterparty')
      throw new ConflictException('CONTRACT_CHANGE_REQUEST_NOT_PENDING')
    return request
  }

  /** Hết hạn xử lý lười: không cần job định kỳ, trạng thái luôn đúng khi đọc hoặc quyết định. */
  private async expireIfDue(
    request: ContractChangeRequest
  ): Promise<ContractChangeRequest> {
    if (
      request.status !== 'pending-counterparty' ||
      request.expiresAt.getTime() > Date.now()
    )
      return request
    request.status = 'expired'
    return this.requests.save(request)
  }

  private participantRole(
    contract: Contract,
    actorId: string
  ): ContractChangeRequestRole {
    if (actorId && contract.landlordId === actorId) return 'landlord'
    if (actorId && contract.tenantId === actorId) return 'tenant'
    throw new ForbiddenException('CONTRACT_CHANGE_REQUEST_ACCESS_DENIED')
  }

  private counterpartyId(
    contract: Contract,
    role: ContractChangeRequestRole
  ): string {
    return role === 'landlord' ? contract.tenantId : contract.landlordId
  }

  private async findContract(contractId: string): Promise<Contract> {
    if (!ObjectId.isValid(contractId))
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    const contract = await this.contracts.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')
    return contract
  }

  private async notify(
    userId: string,
    title: string,
    body: string,
    request: ContractChangeRequest
  ): Promise<void> {
    if (!this.notificationsService) return
    try {
      await this.notificationsService.createNotification(
        userId,
        title,
        body,
        'contract-change-request',
        {
          contractId: request.contractId,
          changeRequestId: request._id.toHexString(),
          status: request.status,
        }
      )
    } catch (error: unknown) {
      this.logger.warn(
        `Change request notification failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
