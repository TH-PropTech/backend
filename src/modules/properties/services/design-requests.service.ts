import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Document } from 'mongodb'
import { ObjectId } from 'mongodb'
import { MongoRepository } from 'typeorm'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { User, UserStatus } from '../../users/schemas/user.schema'
import { Apartment } from '../schemas/apartment.schema'
import {
  ACTIVE_DESIGN_REQUEST_STATUSES,
  DesignRequest,
  MAX_DESIGN_REQUEST_EVENTS,
  type DesignRequestActorRole,
  type DesignRequestEvent,
  type DesignRequestEventType,
  type DesignRequestKind,
  type DesignRequestStatus,
} from '../schemas/design-request.schema'
import {
  parseDesignRequestStatuses,
  type CreateDesignRequestDto,
  type DeliverDesignRequestDto,
  type DesignRequestNoteDto,
  type DesignRequestQueueQueryDto,
  type MyDesignRequestsQueryDto,
} from '../dto/design-request.dto'
import {
  ApartmentDesignsService,
  type AdminApartmentDesign,
} from './apartment-designs.service'

export interface DesignRequestActor {
  id: string
  role: DesignRequestActorRole
}

export interface DesignRequestSummary {
  id: string
  apartmentId: string
  apartment: { id: string; title: string } | null
  landlordId: string
  landlord: { id: string; name: string; email: string } | null
  kind: DesignRequestKind
  targetDesignId: string | null
  brief: string
  attachmentUrls: string[]
  status: DesignRequestStatus
  revision: number
  deliveredDesignId: string | null
  /** Id người đã nhận thiết kế (nhân viên, hoặc admin nếu admin tự làm). Tên trường giữ nguyên để khỏi phải migrate dữ liệu cũ. */
  assignedAdminId: string | null
  /** Người đã nhận thiết kế, kèm tên để hiển thị. */
  assignee: { id: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export interface DesignRequestEventView {
  type: DesignRequestEventType
  actorId: string
  actorName: string | null
  actorRole: DesignRequestActorRole
  note: string | null
  attachmentUrls: string[]
  revision: number
  at: string
}

export interface DesignRequestDetail extends DesignRequestSummary {
  events: DesignRequestEventView[]
  deliveredDesign: AdminApartmentDesign | null
}

export interface DesignRequestListResult {
  items: DesignRequestSummary[]
  total: number
  page: number
  limit: number
}

interface Transition {
  allowedFrom: DesignRequestStatus[]
  to: DesignRequestStatus
  eventType: DesignRequestEventType
  note?: string | null
  attachmentUrls?: string[]
  set?: Record<string, unknown>
  /** Deliver: tăng `revision` và khoá theo revision đã đọc. */
  incRevision?: boolean
}

interface NotificationTarget {
  userId: string
  title: string
  body: string
  link: string
}

const MAX_FAN_OUT = 100
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
/** Nhân viên dùng chung tiền tố /admin của dashboard nhân viên. */
const STAFF_LINK = '/admin/design-requests'
const LANDLORD_LINK = '/profile?tab=listings'

const toIso = (value: Date | string | undefined): string =>
  value ? new Date(value).toISOString() : ''

function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null
}

function clampPaging(
  page?: number,
  limit?: number
): { page: number; limit: number } {
  const p =
    Number.isFinite(page) && (page as number) >= 1
      ? Math.floor(page as number)
      : 1
  const l =
    Number.isFinite(limit) && (limit as number) >= 1
      ? Math.min(Math.floor(limit as number), MAX_LIMIT)
      : DEFAULT_LIMIT
  return { page: p, limit: l }
}

/**
 * Luồng yêu cầu thiết kế 3D: chủ nhà gửi -> nhân viên nhận (hoặc hỏi thêm / từ chối), tự thiết kế &
 * bàn giao -> chủ nhà duyệt hoặc phản hồi (không giới hạn vòng). Admin không nằm trong luồng nhưng
 * vẫn có quyền như nhân viên. Trạng thái `escalated` chỉ còn cho dữ liệu cũ: nhân viên nhận thẳng
 * từ đó. Mọi chuyển trạng thái là một `updateOne` có điều kiện
 * `{_id, status: {$in: allowedFrom}}` nên các lệnh đồng thời không thể áp dụng hai lần.
 */
@Injectable()
export class DesignRequestsService {
  private readonly logger = new Logger(DesignRequestsService.name)

  constructor(
    @InjectRepository(DesignRequest)
    private readonly requestRepository: MongoRepository<DesignRequest>,
    @InjectRepository(Apartment)
    private readonly apartmentRepository: MongoRepository<Apartment>,
    @InjectRepository(User)
    private readonly userRepository: MongoRepository<User>,
    private readonly designs: ApartmentDesignsService,
    private readonly notifications: NotificationsService
  ) {}

  // ── Tạo / đọc ──

  async create(
    actor: DesignRequestActor,
    dto: CreateDesignRequestDto
  ): Promise<DesignRequestDetail> {
    const apartment = await this.loadApartment(dto.apartmentId)
    if (!apartment) throw new NotFoundException('APARTMENT_NOT_FOUND')
    if (apartment.landlordId !== actor.id) {
      throw new ForbiddenException('APARTMENT_ACCESS_DENIED')
    }

    let targetDesignId: string | null = null
    if (dto.kind === 'edit') {
      if (!dto.targetDesignId) {
        throw new BadRequestException('TARGET_DESIGN_REQUIRED')
      }
      const existing = await this.designs.listAll(dto.apartmentId)
      if (!existing.some(d => d.id === dto.targetDesignId)) {
        throw new BadRequestException('DESIGN_NOT_FOUND')
      }
      targetDesignId = dto.targetDesignId
    }

    const active = await this.requestRepository.findOne({
      where: {
        apartmentId: dto.apartmentId,
        status: { $in: [...ACTIVE_DESIGN_REQUEST_STATUSES] },
      },
    })
    if (active) throw new ConflictException('DESIGN_REQUEST_ACTIVE_EXISTS')

    const attachmentUrls = dto.attachmentUrls ?? []
    const now = new Date()
    const entity = this.requestRepository.create({
      apartmentId: dto.apartmentId,
      landlordId: actor.id,
      kind: dto.kind,
      targetDesignId,
      brief: dto.brief,
      attachmentUrls,
      status: 'submitted',
      revision: 0,
      deliveredDesignId: null,
      assignedAdminId: null,
      events: [
        {
          type: 'submitted',
          actorId: actor.id,
          actorRole: 'landlord',
          note: null,
          attachmentUrls,
          revision: 0,
          at: now,
        },
      ],
    })
    const saved = await this.requestRepository.save(entity)
    await this.notify(saved, 'submitted')
    return this.toDetail(saved)
  }

  async listMine(
    landlordId: string,
    query: MyDesignRequestsQueryDto
  ): Promise<DesignRequestListResult> {
    const { page, limit } = clampPaging(query.page, query.limit)
    const where: Record<string, unknown> = { landlordId }
    if (query.apartmentId) where.apartmentId = query.apartmentId
    if (query.status) where.status = query.status
    const [rows, total] = await this.requestRepository.findAndCount({
      where: where as never,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    })
    return { items: await this.toSummaries(rows), total, page, limit }
  }

  async queue(
    query: DesignRequestQueueQueryDto
  ): Promise<DesignRequestListResult> {
    const { page, limit } = clampPaging(query.page, query.limit)
    const parsed = parseDesignRequestStatuses(query.status)
    if (parsed === null) throw new BadRequestException('INVALID_STATUS')
    const statuses = parsed.length > 0 ? parsed : ACTIVE_DESIGN_REQUEST_STATUSES
    const [rows, total] = await this.requestRepository.findAndCount({
      where: { status: { $in: [...statuses] } } as never,
      order: { updatedAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    })
    return { items: await this.toSummaries(rows), total, page, limit }
  }

  async getById(
    id: string,
    actor: DesignRequestActor
  ): Promise<DesignRequestDetail> {
    const request = await this.findOrThrow(id)
    if (actor.role === 'landlord') this.assertOwner(request, actor)
    return this.toDetail(request)
  }

  // ── Chủ nhà ──

  async reply(
    id: string,
    actor: DesignRequestActor,
    dto: DesignRequestNoteDto
  ): Promise<DesignRequestDetail> {
    const request = await this.findOwned(id, actor)
    return this.transition(request, actor, {
      allowedFrom: ['needs_info'],
      to: 'submitted',
      eventType: 'info_provided',
      note: dto.note,
      attachmentUrls: dto.attachmentUrls ?? [],
    })
  }

  async feedback(
    id: string,
    actor: DesignRequestActor,
    dto: DesignRequestNoteDto
  ): Promise<DesignRequestDetail> {
    const request = await this.findOwned(id, actor)
    return this.transition(request, actor, {
      allowedFrom: ['delivered'],
      to: 'changes_requested',
      eventType: 'feedback',
      note: dto.note,
      attachmentUrls: dto.attachmentUrls ?? [],
    })
  }

  async cancel(
    id: string,
    actor: DesignRequestActor
  ): Promise<DesignRequestDetail> {
    const request = await this.findOwned(id, actor)
    return this.transition(request, actor, {
      allowedFrom: [...ACTIVE_DESIGN_REQUEST_STATUSES],
      to: 'cancelled',
      eventType: 'cancelled',
    })
  }

  /**
   * Duyệt: cập nhật hiển thị thiết kế TRƯỚC rồi mới lật trạng thái. Hiển thị là `$set` idempotent nên
   * nếu bước nào hỏng, yêu cầu vẫn ở `delivered` và chủ nhà bấm duyệt lại được (không kẹt ở `approved`
   * mà thiết kế vẫn ẩn). Nếu lật trạng thái thua một lệnh đồng thời (vd. huỷ), hoàn lại hiển thị cũ.
   */
  async approve(
    id: string,
    actor: DesignRequestActor
  ): Promise<DesignRequestDetail> {
    const request = await this.findOwned(id, actor)
    this.assertState(request, ['delivered'])
    const deliveredId = request.deliveredDesignId
    if (!deliveredId) throw new BadRequestException('DESIGN_NOT_FOUND')

    const existing = await this.designs.listAll(request.apartmentId)
    const delivered = existing.find(d => d.id === deliveredId)
    if (!delivered) throw new BadRequestException('DESIGN_NOT_FOUND')
    const replacedId =
      request.kind === 'edit' &&
      request.targetDesignId &&
      request.targetDesignId !== deliveredId
        ? request.targetDesignId
        : null
    const replaced = replacedId
      ? existing.find(d => d.id === replacedId)
      : undefined

    try {
      await this.designs.setVisible(request.apartmentId, deliveredId, true)
      if (replaced) {
        await this.designs.setVisible(request.apartmentId, replaced.id, false)
      }
    } catch (error) {
      this.logger.error(
        `Design request ${id}: visibility update failed: ${error instanceof Error ? error.message : 'unknown'}`
      )
      await this.restoreVisibility(request.apartmentId, delivered, replaced)
      throw new InternalServerErrorException('DESIGN_VISIBILITY_UPDATE_FAILED')
    }

    try {
      return await this.transition(request, actor, {
        allowedFrom: ['delivered'],
        to: 'approved',
        eventType: 'approved',
      })
    } catch (error) {
      // Thua lệnh đồng thời: chỉ hoàn lại khi yêu cầu KHÔNG phải đã được duyệt bởi lệnh thắng.
      const current = await this.findOrThrow(id).catch(() => null)
      if (current?.status !== 'approved') {
        await this.restoreVisibility(request.apartmentId, delivered, replaced)
      }
      throw error
    }
  }

  // ── Staff / admin ──

  async requestInfo(
    id: string,
    actor: DesignRequestActor,
    dto: DesignRequestNoteDto
  ): Promise<DesignRequestDetail> {
    const request = await this.findOrThrow(id)
    return this.transition(request, actor, {
      allowedFrom: ['submitted'],
      to: 'needs_info',
      eventType: 'info_requested',
      note: dto.note,
      attachmentUrls: dto.attachmentUrls ?? [],
    })
  }

  async reject(
    id: string,
    actor: DesignRequestActor,
    dto: DesignRequestNoteDto
  ): Promise<DesignRequestDetail> {
    const request = await this.findOrThrow(id)
    return this.transition(request, actor, {
      allowedFrom: ['submitted', 'escalated'],
      to: 'rejected',
      eventType: 'rejected',
      note: dto.note,
      attachmentUrls: dto.attachmentUrls ?? [],
    })
  }

  /**
   * Nhận thiết kế. Là một `updateOne` có điều kiện trạng thái nên hai nhân viên bấm cùng lúc thì chỉ
   * một người thắng, người còn lại nhận 409.
   */
  async start(
    id: string,
    actor: DesignRequestActor
  ): Promise<DesignRequestDetail> {
    this.assertDesigner(actor)
    const request = await this.findOrThrow(id)
    return this.transition(request, actor, {
      allowedFrom: ['submitted', 'escalated', 'changes_requested'],
      to: 'in_progress',
      eventType: 'started',
      set: { assignedAdminId: actor.id },
    })
  }

  async deliver(
    id: string,
    actor: DesignRequestActor,
    dto: DeliverDesignRequestDto
  ): Promise<DesignRequestDetail> {
    this.assertDesigner(actor)
    const request = await this.findOrThrow(id)
    this.assertState(request, ['in_progress'])
    if (
      actor.role !== 'admin' &&
      request.assignedAdminId &&
      request.assignedAdminId !== actor.id
    ) {
      throw new ForbiddenException('DESIGN_REQUEST_NOT_ASSIGNEE')
    }
    const existing = await this.designs.listAll(request.apartmentId)
    if (!existing.some(d => d.id === dto.designId)) {
      throw new BadRequestException('DESIGN_NOT_FOUND')
    }
    return this.transition(request, actor, {
      allowedFrom: ['in_progress'],
      to: 'delivered',
      eventType: 'delivered',
      note: dto.note || null,
      set: { deliveredDesignId: dto.designId },
      incRevision: true,
    })
  }

  // ── Lõi chuyển trạng thái ──

  private async transition(
    request: DesignRequest,
    actor: DesignRequestActor,
    t: Transition
  ): Promise<DesignRequestDetail> {
    this.assertState(request, t.allowedFrom)
    const now = new Date()
    const revision = t.incRevision ? request.revision + 1 : request.revision
    const event: DesignRequestEvent = {
      type: t.eventType,
      actorId: actor.id,
      actorRole: actor.role,
      note: t.note ?? null,
      attachmentUrls: t.attachmentUrls ?? [],
      revision,
      at: now,
    }
    const filter: Document = {
      _id: request._id,
      status: { $in: t.allowedFrom },
    }
    if (t.incRevision) filter.revision = request.revision
    const update: Document = {
      $set: { status: t.to, updatedAt: now, ...t.set },
      $push: { events: { $each: [event], $slice: -MAX_DESIGN_REQUEST_EVENTS } },
    }
    if (t.incRevision) update.$inc = { revision: 1 }

    const result = await this.requestRepository.updateOne(filter, update)
    if (result.matchedCount === 0) {
      throw new ConflictException('DESIGN_REQUEST_INVALID_STATE')
    }
    const fresh = await this.findOrThrow(request._id.toHexString())
    await this.notify(fresh, t.eventType)
    return this.toDetail(fresh)
  }

  private assertState(
    request: DesignRequest,
    allowedFrom: readonly DesignRequestStatus[]
  ): void {
    if (!allowedFrom.includes(request.status)) {
      throw new ConflictException('DESIGN_REQUEST_INVALID_STATE')
    }
  }

  private assertDesigner(actor: DesignRequestActor): void {
    if (actor.role !== 'staff' && actor.role !== 'admin') {
      throw new ForbiddenException('DESIGN_REQUEST_STAFF_ONLY')
    }
  }

  private assertOwner(request: DesignRequest, actor: DesignRequestActor): void {
    if (request.landlordId !== actor.id) {
      throw new ForbiddenException('DESIGN_REQUEST_ACCESS_DENIED')
    }
  }

  private async findOrThrow(id: string): Promise<DesignRequest> {
    const _id = toObjectId(id)
    const request = _id
      ? await this.requestRepository.findOne({ where: { _id } })
      : null
    if (!request) throw new NotFoundException('DESIGN_REQUEST_NOT_FOUND')
    return request
  }

  private async findOwned(
    id: string,
    actor: DesignRequestActor
  ): Promise<DesignRequest> {
    const request = await this.findOrThrow(id)
    this.assertOwner(request, actor)
    return request
  }

  private async restoreVisibility(
    apartmentId: string,
    delivered: AdminApartmentDesign,
    replaced: AdminApartmentDesign | undefined
  ): Promise<void> {
    try {
      await this.designs.setVisible(
        apartmentId,
        delivered.id,
        delivered.visible
      )
      if (replaced) {
        await this.designs.setVisible(
          apartmentId,
          replaced.id,
          replaced.visible
        )
      }
    } catch (error) {
      this.logger.error(
        `Design visibility rollback failed: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  // ── Hydrate ──

  private async loadApartment(
    id: string
  ): Promise<{ title: string; landlordId: string } | null> {
    const _id = toObjectId(id)
    if (!_id) return null
    const rows = (await this.apartmentRepository
      .aggregate([
        { $match: { _id } },
        { $project: { title: 1, landlordId: 1 } },
      ])
      .toArray()) as Array<{ title?: string; landlordId?: string }>
    const row = rows[0]
    if (!row) return null
    return { title: row.title ?? '', landlordId: row.landlordId ?? '' }
  }

  private async apartmentTitles(ids: string[]): Promise<Map<string, string>> {
    const objectIds = [...new Set(ids)]
      .map(toObjectId)
      .filter((v): v is ObjectId => v !== null)
    if (objectIds.length === 0) return new Map()
    const rows = (await this.apartmentRepository
      .aggregate([
        { $match: { _id: { $in: objectIds } } },
        { $project: { title: 1 } },
      ])
      .toArray()) as Array<{ _id: ObjectId; title?: string }>
    return new Map(rows.map(r => [r._id.toString(), r.title ?? '']))
  }

  private async userNames(
    ids: string[]
  ): Promise<Map<string, { name: string; email: string }>> {
    const objectIds = [...new Set(ids)]
      .map(toObjectId)
      .filter((v): v is ObjectId => v !== null)
    if (objectIds.length === 0) return new Map()
    const rows = (await this.userRepository
      .aggregate([
        { $match: { _id: { $in: objectIds } } },
        { $project: { fullName: 1, email: 1 } },
      ])
      .toArray()) as Array<{ _id: ObjectId; fullName?: string; email?: string }>
    return new Map(
      rows.map(r => [
        r._id.toString(),
        { name: r.fullName ?? '', email: r.email ?? '' },
      ])
    )
  }

  private buildSummary(
    r: DesignRequest,
    titles: Map<string, string>,
    users: Map<string, { name: string; email: string }>
  ): DesignRequestSummary {
    const title = titles.get(r.apartmentId)
    const landlord = users.get(r.landlordId)
    const assigneeId = r.assignedAdminId ?? null
    const assignee = assigneeId ? users.get(assigneeId) : undefined
    return {
      id: r._id.toString(),
      apartmentId: r.apartmentId,
      apartment: title === undefined ? null : { id: r.apartmentId, title },
      landlordId: r.landlordId,
      landlord: landlord
        ? { id: r.landlordId, name: landlord.name, email: landlord.email }
        : null,
      kind: r.kind,
      targetDesignId: r.targetDesignId ?? null,
      brief: r.brief,
      attachmentUrls: r.attachmentUrls ?? [],
      status: r.status,
      revision: r.revision ?? 0,
      deliveredDesignId: r.deliveredDesignId ?? null,
      assignedAdminId: assigneeId,
      assignee:
        assigneeId && assignee ? { id: assigneeId, name: assignee.name } : null,
      createdAt: toIso(r.createdAt),
      updatedAt: toIso(r.updatedAt),
    }
  }

  private async toSummaries(
    rows: DesignRequest[]
  ): Promise<DesignRequestSummary[]> {
    if (rows.length === 0) return []
    const [titles, users] = await Promise.all([
      this.apartmentTitles(rows.map(r => r.apartmentId)),
      this.userNames(
        rows.flatMap(r =>
          r.assignedAdminId ? [r.landlordId, r.assignedAdminId] : [r.landlordId]
        )
      ),
    ])
    return rows.map(r => this.buildSummary(r, titles, users))
  }

  private async toDetail(r: DesignRequest): Promise<DesignRequestDetail> {
    const events = r.events ?? []
    const [titles, users] = await Promise.all([
      this.apartmentTitles([r.apartmentId]),
      this.userNames([
        r.landlordId,
        ...(r.assignedAdminId ? [r.assignedAdminId] : []),
        ...events.map(e => e.actorId),
      ]),
    ])
    let deliveredDesign: AdminApartmentDesign | null = null
    if (r.deliveredDesignId) {
      try {
        const all = await this.designs.listAll(r.apartmentId)
        deliveredDesign = all.find(d => d.id === r.deliveredDesignId) ?? null
      } catch {
        deliveredDesign = null
      }
    }
    return {
      ...this.buildSummary(r, titles, users),
      events: events.map(e => ({
        type: e.type,
        actorId: e.actorId,
        actorName: users.get(e.actorId)?.name ?? null,
        actorRole: e.actorRole,
        note: e.note ?? null,
        attachmentUrls: e.attachmentUrls ?? [],
        revision: e.revision,
        at: toIso(e.at),
      })),
      deliveredDesign,
    }
  }

  // ── Thông báo ──

  /** Lỗi thông báo không bao giờ làm hỏng yêu cầu đã ghi. */
  private async notify(
    request: DesignRequest,
    eventType: DesignRequestEventType
  ): Promise<void> {
    try {
      const id = request._id.toHexString()
      const titles = await this.apartmentTitles([request.apartmentId])
      const apartmentTitle = titles.get(request.apartmentId) ?? 'căn hộ'
      const targets = await this.recipients(request, eventType, apartmentTitle)
      const count = request.events?.length ?? 0
      const key = `design-request:${id}:${eventType}:${request.revision}:${count}`
      await Promise.all(
        targets.map(target =>
          this.safeNotify(() =>
            this.notifications.createNotificationOnce(
              target.userId,
              key,
              target.title,
              target.body,
              'DESIGN_REQUEST',
              { requestId: id, status: request.status, link: target.link }
            )
          )
        )
      )
    } catch (error) {
      this.logger.warn(
        `Design request notification failed: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  private async safeNotify(send: () => Promise<unknown>): Promise<void> {
    try {
      await send()
    } catch (error) {
      this.logger.warn(
        `Design request notification failed: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  private async usersWithRole(role: 'staff' | 'admin'): Promise<string[]> {
    const users = await this.userRepository.find({
      where: { role, status: UserStatus.ACTIVE } as never,
      take: MAX_FAN_OUT,
    })
    return users.map(u => u._id.toString())
  }

  private async recipients(
    r: DesignRequest,
    eventType: DesignRequestEventType,
    apartmentTitle: string
  ): Promise<NotificationTarget[]> {
    const to = (
      userIds: string[],
      title: string,
      body: string,
      link: string
    ): NotificationTarget[] =>
      userIds.map(userId => ({ userId, title, body, link }))

    switch (eventType) {
      case 'submitted':
        return to(
          await this.usersWithRole('staff'),
          'Yêu cầu thiết kế 3D mới',
          `Có yêu cầu thiết kế 3D mới cho căn hộ "${apartmentTitle}" cần phân loại.`,
          STAFF_LINK
        )
      case 'info_provided':
        return to(
          await this.usersWithRole('staff'),
          'Chủ nhà đã bổ sung thông tin',
          `Chủ nhà đã bổ sung thông tin cho yêu cầu thiết kế 3D của căn hộ "${apartmentTitle}".`,
          STAFF_LINK
        )
      case 'feedback': {
        const designers = r.assignedAdminId
          ? [r.assignedAdminId]
          : await this.usersWithRole('staff')
        return to(
          designers,
          'Chủ nhà yêu cầu chỉnh sửa thiết kế',
          `Chủ nhà đã gửi phản hồi cho thiết kế 3D của căn hộ "${apartmentTitle}" (lần ${r.revision}).`,
          STAFF_LINK
        )
      }
      case 'info_requested':
        return to(
          [r.landlordId],
          'Cần bổ sung thông tin thiết kế 3D',
          `Nhân viên cần thêm thông tin cho yêu cầu thiết kế 3D của căn hộ "${apartmentTitle}".`,
          LANDLORD_LINK
        )
      case 'rejected':
        return to(
          [r.landlordId],
          'Yêu cầu thiết kế 3D bị từ chối',
          `Yêu cầu thiết kế 3D của căn hộ "${apartmentTitle}" đã bị từ chối. Xem lý do trong chi tiết yêu cầu.`,
          LANDLORD_LINK
        )
      case 'started':
        return to(
          [r.landlordId],
          'Nhân viên đã bắt đầu thiết kế',
          `Nhân viên đã bắt đầu thiết kế 3D cho căn hộ "${apartmentTitle}".`,
          LANDLORD_LINK
        )
      case 'delivered':
        return to(
          [r.landlordId],
          'Thiết kế 3D đã sẵn sàng để duyệt',
          `Thiết kế 3D của căn hộ "${apartmentTitle}" đã sẵn sàng (lần ${r.revision}). Hãy xem và duyệt hoặc gửi phản hồi.`,
          LANDLORD_LINK
        )
      case 'approved':
        return r.assignedAdminId
          ? to(
              [r.assignedAdminId],
              'Chủ nhà đã duyệt thiết kế 3D',
              `Chủ nhà đã duyệt thiết kế 3D của căn hộ "${apartmentTitle}".`,
              STAFF_LINK
            )
          : []
      default:
        return []
    }
  }
}
