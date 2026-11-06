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
import { Apartment } from '../../properties/schemas/apartment.schema'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { resolveEffectiveCommercial } from '../commercial/resolve-effective-commercial'
import type {
  CreateOccupantRequestDto,
  OccupantRequestDecisionDto,
} from '../dto/occupant-change-request.dto'
import { Contract } from '../schemas/contract.schema'
import {
  OccupantChangeRequest,
  type OccupantRequestAuditEntry,
} from '../schemas/occupant-change-request.schema'
import { ContractAmendmentService } from './contract-amendment.service'

/** Trần cứng khi căn hộ chưa đặt `maxOccupants` (tin cũ). */
const FALLBACK_MAX_OCCUPANTS = 20
const DAY_MS = 86_400_000
const OPEN_STATUSES = ['pending-landlord', 'pending-tenant'] as const

export type OccupantRequestActor = {
  actorId: string
  isStaff: boolean
}

export type OccupantRequestListView = {
  /** Số người ở hiện tại gồm cả người thuê. */
  currentOccupants: number
  /** Giới hạn của căn hộ; null khi tin cũ chưa đặt giới hạn. */
  maxOccupants: number | null
  openRequest: OccupantChangeRequest | null
  requests: OccupantChangeRequest[]
}

type Role = 'tenant' | 'landlord'

@Injectable()
export class OccupantChangeRequestService {
  private readonly logger = new Logger(OccupantChangeRequestService.name)

  constructor(
    @InjectRepository(OccupantChangeRequest)
    private readonly requests: Repository<OccupantChangeRequest>,
    @InjectRepository(Contract)
    private readonly contracts: Repository<Contract>,
    @InjectRepository(Apartment)
    private readonly apartments: Repository<Apartment>,
    private readonly amendmentService: ContractAmendmentService,
    @Optional() private readonly notificationsService?: NotificationsService
  ) {}

  async create(
    contractId: string,
    input: CreateOccupantRequestDto,
    actor: OccupantRequestActor
  ): Promise<OccupantChangeRequest> {
    const contract = await this.findContract(contractId)
    if (contract.tenantId !== actor.actorId) {
      throw new ForbiddenException('OCCUPANT_REQUEST_TENANT_ONLY')
    }
    if (contract.status !== 'active') {
      throw new ConflictException('OCCUPANT_REQUEST_CONTRACT_NOT_ACTIVE')
    }
    await this.assertNoOpenRequest(contractId)
    const { current, max } = await this.occupancy(contract)
    this.assertWithinLimit(max, current + input.occupants.length)

    const now = new Date()
    const request = this.requests.create({
      contractId,
      tenantId: contract.tenantId,
      landlordId: contract.landlordId,
      occupants: input.occupants.map(person => ({
        fullName: person.fullName,
        birthYear: person.birthYear,
        relationship: person.relationship,
        idPhotoUrls: person.idPhotoUrls,
      })),
      moveInDate: new Date(input.moveInDate),
      reason: input.reason,
      proposedSurcharge: input.proposedSurcharge,
      counterSurcharge: null,
      agreedSurcharge: null,
      status: 'pending-landlord',
      decisionReason: null,
      amendmentId: null,
      auditTrail: [
        this.audit(
          now,
          actor.actorId,
          'tenant',
          'submitted',
          `Phụ phí đề xuất ${input.proposedSurcharge}`
        ),
      ],
    })
    const saved = await this.requests.save(request)
    await this.notify(
      contract.landlordId,
      'Có yêu cầu thêm người ở',
      'Khách thuê đề nghị thêm người ở cùng và đang chờ bạn phản hồi.',
      saved
    )
    return saved
  }

  async list(
    contractId: string,
    actor: OccupantRequestActor
  ): Promise<OccupantRequestListView> {
    const contract = await this.findContract(contractId)
    if (!actor.isStaff) this.participantRole(contract, actor.actorId)
    const found = await this.requests.find({ where: { contractId } })
    const requests = found.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )
    const { current, max } = await this.occupancy(contract)
    return {
      currentOccupants: current,
      maxOccupants: max,
      openRequest:
        requests.find(item =>
          (OPEN_STATUSES as readonly string[]).includes(item.status)
        ) ?? null,
      requests,
    }
  }

  async decide(
    contractId: string,
    requestId: string,
    input: OccupantRequestDecisionDto,
    actor: OccupantRequestActor
  ): Promise<OccupantChangeRequest> {
    const contract = await this.findContract(contractId)
    if (contract.landlordId !== actor.actorId) {
      throw new ForbiddenException('OCCUPANT_REQUEST_LANDLORD_ONLY')
    }
    const request = await this.findRequest(contractId, requestId)
    if (request.status !== 'pending-landlord') {
      throw new ConflictException('OCCUPANT_REQUEST_NOT_PENDING')
    }
    const now = new Date()
    if (input.action === 'reject') {
      return this.close(request, actor.actorId, 'landlord', input.reason, now)
    }
    // Giới hạn có thể đã giảm sau khi yêu cầu được gửi; kiểm lại trước khi duyệt hoặc đề xuất lại.
    const { current, max } = await this.occupancy(contract)
    this.assertWithinLimit(max, current + request.occupants.length)

    if (input.action === 'counter') {
      if (input.counterSurcharge === undefined) {
        throw new BadRequestException('Vui lòng nhập mức phụ phí đề xuất lại.')
      }
      request.counterSurcharge = input.counterSurcharge
      request.status = 'pending-tenant'
      request.decisionReason = input.reason ?? null
      request.auditTrail = [
        ...request.auditTrail,
        this.audit(
          now,
          actor.actorId,
          'landlord',
          'countered',
          `Phụ phí đề xuất lại ${input.counterSurcharge}`
        ),
      ]
      const saved = await this.requests.save(request)
      await this.notify(
        request.tenantId,
        'Chủ nhà đề xuất lại phụ phí',
        'Chủ nhà đã đề xuất mức phụ phí khác cho yêu cầu thêm người ở. Vui lòng xem và trả lời.',
        saved
      )
      return saved
    }
    return this.agree(
      contract,
      request,
      request.proposedSurcharge,
      actor.actorId,
      'landlord',
      now
    )
  }

  async respondToCounter(
    contractId: string,
    requestId: string,
    accept: boolean,
    actor: OccupantRequestActor
  ): Promise<OccupantChangeRequest> {
    const contract = await this.findContract(contractId)
    if (contract.tenantId !== actor.actorId) {
      throw new ForbiddenException('OCCUPANT_REQUEST_TENANT_ONLY')
    }
    const request = await this.findRequest(contractId, requestId)
    if (request.status !== 'pending-tenant') {
      throw new ConflictException('OCCUPANT_REQUEST_NOT_PENDING')
    }
    const now = new Date()
    if (!accept) {
      return this.close(request, actor.actorId, 'tenant', undefined, now)
    }
    const { current, max } = await this.occupancy(contract)
    this.assertWithinLimit(max, current + request.occupants.length)
    return this.agree(
      contract,
      request,
      request.counterSurcharge ?? request.proposedSurcharge,
      actor.actorId,
      'tenant',
      now
    )
  }

  /** Tạo phụ lục: người ở mới và (nếu có phụ phí) tiền thuê mới cho các kỳ chưa thanh toán. */
  private async agree(
    contract: Contract,
    request: OccupantChangeRequest,
    surcharge: number,
    actorId: string,
    role: Role,
    now: Date
  ): Promise<OccupantChangeRequest> {
    const commercial = resolveEffectiveCommercial(contract)
    const occupants = [
      ...(commercial.occupants ?? []),
      ...request.occupants.map(person => ({
        fullName: person.fullName,
        birthYear: person.birthYear,
        relationship: person.relationship,
      })),
    ]
    const changes: Array<{ field: string; after: unknown }> = [
      { field: 'occupants', after: occupants },
    ]
    if (surcharge > 0) {
      changes.push({
        field: 'monthlyRent',
        after: commercial.monthlyRent + surcharge,
      })
    }
    const tomorrow = new Date(now.getTime() + DAY_MS)
    const effectiveFrom =
      request.moveInDate.getTime() > tomorrow.getTime()
        ? request.moveInDate
        : tomorrow
    const amendment = await this.amendmentService.create(
      request.contractId,
      {
        changes,
        effectiveFrom: effectiveFrom.toISOString(),
        idempotencyKey: `occupant-request:${request._id.toHexString()}`,
      },
      { actorId: contract.landlordId, isStaff: false, role: 'landlord' }
    )
    request.status = 'agreed'
    request.agreedSurcharge = surcharge
    request.amendmentId = amendment._id.toHexString()
    request.auditTrail = [
      ...request.auditTrail,
      this.audit(
        now,
        actorId,
        role,
        'agreed',
        `Phụ phí thống nhất ${surcharge}`
      ),
    ]
    const saved = await this.requests.save(request)
    const otherParty =
      role === 'landlord' ? contract.tenantId : contract.landlordId
    await this.notify(
      otherParty,
      'Đã thống nhất thêm người ở',
      'Hai bên đã thống nhất. Phụ lục hợp đồng đã được tạo và cần hai bên xác nhận để có hiệu lực.',
      saved
    )
    return saved
  }

  private async close(
    request: OccupantChangeRequest,
    actorId: string,
    role: Role,
    reason: string | undefined,
    now: Date
  ): Promise<OccupantChangeRequest> {
    request.status = 'rejected'
    request.decisionReason = reason ?? request.decisionReason ?? null
    request.auditTrail = [
      ...request.auditTrail,
      this.audit(now, actorId, role, 'rejected', reason ?? null),
    ]
    const saved = await this.requests.save(request)
    await this.notify(
      role === 'landlord' ? request.tenantId : request.landlordId,
      'Yêu cầu thêm người ở đã đóng',
      role === 'landlord'
        ? 'Chủ nhà đã từ chối yêu cầu thêm người ở. Người ở và tiền thuê không thay đổi.'
        : 'Khách thuê không đồng ý mức phụ phí mới. Người ở và tiền thuê không thay đổi.',
      saved
    )
    return saved
  }

  private async occupancy(
    contract: Contract
  ): Promise<{ current: number; max: number | null }> {
    const apartment = ObjectId.isValid(contract.propertyId)
      ? await this.apartments.findOne({
          where: { _id: new ObjectId(contract.propertyId) },
        })
      : null
    const co = resolveEffectiveCommercial(contract).occupants ?? []
    return { current: 1 + co.length, max: apartment?.maxOccupants ?? null }
  }

  private assertWithinLimit(max: number | null, total: number): void {
    const limit = max ?? FALLBACK_MAX_OCCUPANTS
    if (total > limit) {
      throw new BadRequestException(
        `Căn hộ này cho phép tối đa ${limit} người ở.`
      )
    }
  }

  private async assertNoOpenRequest(contractId: string): Promise<void> {
    const open = await this.requests.findOne({
      where: [
        { contractId, status: 'pending-landlord' },
        { contractId, status: 'pending-tenant' },
      ],
    })
    if (open) throw new ConflictException('OCCUPANT_REQUEST_IN_PROGRESS')
  }

  private participantRole(contract: Contract, actorId: string): Role {
    if (contract.tenantId === actorId) return 'tenant'
    if (contract.landlordId === actorId) return 'landlord'
    throw new ForbiddenException('OCCUPANT_REQUEST_FORBIDDEN')
  }

  private audit(
    at: Date,
    actorId: string,
    actorRole: Role,
    action: string,
    detail: string | null
  ): OccupantRequestAuditEntry {
    return { at, actorId, actorRole, action, detail }
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

  private async findRequest(
    contractId: string,
    requestId: string
  ): Promise<OccupantChangeRequest> {
    if (!ObjectId.isValid(requestId))
      throw new NotFoundException('OCCUPANT_REQUEST_NOT_FOUND')
    const request = await this.requests.findOne({
      where: { _id: new ObjectId(requestId), contractId },
    })
    if (!request) throw new NotFoundException('OCCUPANT_REQUEST_NOT_FOUND')
    return request
  }

  private async notify(
    userId: string,
    title: string,
    body: string,
    request: OccupantChangeRequest
  ): Promise<void> {
    if (!this.notificationsService) return
    try {
      await this.notificationsService.createNotification(
        userId,
        title,
        body,
        'occupant-change-request',
        {
          contractId: request.contractId,
          occupantRequestId: request._id.toHexString(),
          status: request.status,
        }
      )
    } catch (error: unknown) {
      this.logger.warn(
        `Occupant request notification failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
