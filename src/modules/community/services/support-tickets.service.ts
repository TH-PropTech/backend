import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { MongoRepository, FindOptionsWhere } from 'typeorm'
import { ObjectId } from 'mongodb'
import type {
  Document,
  PushOperator,
  UpdateFilter,
} from 'typeorm/driver/mongodb/typings'
import {
  MAX_TICKET_MESSAGES,
  SupportTicket,
  TicketMessageEntry,
  TicketPriority,
  TransferHistoryItem,
} from '../schemas/support-ticket.schema'
import { TicketMessage } from '../schemas/ticket-message.schema'
import {
  CreateSupportTicketDto,
  AddTicketMessageDto,
  AssignTicketDto,
  EscalateTicketDto,
  ResolveTicketDto,
  SupportTicketQueryDto,
} from '../dto/support-ticket.dto'
import { NotificationsService } from '../../notifications/services/notifications.service'

/** SLA deadlines by priority (in hours) */
const SLA_HOURS: Record<TicketPriority, number> = {
  low: 72,
  normal: 24,
  high: 8,
  urgent: 4,
}

/**
 * Mọi trường của ticket TRỪ `messages`. Danh sách/tra cứu thường chiếu theo
 * danh sách này để không kéo theo (và không lộ ghi chú `isInternal` của)
 * `messages[]` nhúng.
 */
const TICKET_FIELDS_WITHOUT_MESSAGES: (keyof SupportTicket)[] = [
  '_id',
  'requesterId',
  'requesterRole',
  'category',
  'subject',
  'description',
  'linkedEntityType',
  'linkedEntityId',
  'priority',
  'status',
  'assignedTo',
  'assignedAt',
  'slaDeadline',
  'firstResponseAt',
  'resolvedAt',
  'closedAt',
  'resolutionNote',
  'escalatedTo',
  'escalatedAt',
  'escalationReason',
  'transferHistory',
  'createdAt',
  'updatedAt',
]

/** Bản sao ticket không có `messages` (hình dạng phản hồi cũ). */
function omitMessages(ticket: SupportTicket): SupportTicket {
  const copy = { ...ticket }
  delete copy.messages
  return copy
}

/** Ánh xạ tin nhúng sang hình `TicketMessage` cũ (có `ticketId`). */
function toTicketMessage(
  ticketId: string,
  entry: TicketMessageEntry
): TicketMessage {
  return {
    _id: entry._id,
    ticketId,
    senderId: entry.senderId,
    senderRole: entry.senderRole,
    content: entry.content,
    attachmentUrls: entry.attachmentUrls,
    isInternal: entry.isInternal,
    createdAt: entry.createdAt,
  }
}

export interface TicketListResult {
  items: SupportTicket[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface TicketDetailResult {
  ticket: SupportTicket
  messages: TicketMessage[]
}

@Injectable()
export class SupportTicketsService {
  private readonly logger = new Logger(SupportTicketsService.name)

  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepository: MongoRepository<SupportTicket>,
    private readonly notificationsService: NotificationsService
  ) {}

  /**
   * Tạo yêu cầu hỗ trợ mới kèm tính SLA tự động
   * [uc_support_ticket_create]
   */
  async createTicket(
    requesterId: string,
    requesterRole: string,
    dto: CreateSupportTicketDto
  ): Promise<SupportTicket> {
    this.logger.log(
      `User ${requesterId} creating support ticket [${dto.category}]: ${dto.subject}`
    )

    if (Boolean(dto.linkedEntityType) !== Boolean(dto.linkedEntityId)) {
      throw new BadRequestException(
        'Loại đối tượng liên kết và ID đối tượng phải được cung cấp cùng nhau'
      )
    }

    const priority = dto.priority ?? 'normal'
    const slaHours = SLA_HOURS[priority]
    const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000)

    const ticketData: Partial<SupportTicket> = {
      requesterId,
      requesterRole,
      category: dto.category,
      subject: dto.subject,
      description: dto.description,
      priority,
      status: 'open',
      slaDeadline,
      transferHistory: [],
      // Tin đầu tiên (= description) nhúng ngay trong cùng lần ghi.
      messages: [
        {
          _id: new ObjectId(),
          senderId: requesterId,
          senderRole: requesterRole,
          content: dto.description,
          attachmentUrls: [],
          isInternal: false,
          createdAt: new Date(),
        },
      ],
    }
    if (dto.linkedEntityType) ticketData.linkedEntityType = dto.linkedEntityType
    if (dto.linkedEntityId) ticketData.linkedEntityId = dto.linkedEntityId

    const ticket = this.ticketRepository.create(ticketData)

    const saved = await this.ticketRepository.save(ticket)

    // Notify staff
    await this.notificationsService.createNotification(
      'staff',
      'Yêu cầu hỗ trợ mới',
      `[${priority.toUpperCase()}] ${dto.subject}`,
      'SUPPORT_TICKET',
      { ticketId: String(saved._id), category: dto.category, priority }
    )

    return omitMessages(saved)
  }

  /**
   * Lấy danh sách ticket của requester
   */
  async getMyTickets(
    userId: string,
    query: SupportTicketQueryDto
  ): Promise<TicketListResult> {
    const where: Record<string, unknown> = { requesterId: userId }
    if (query.status) where.status = query.status
    if (query.category) where.category = query.category

    const allRecords = await this.ticketRepository.find({
      where: where as FindOptionsWhere<SupportTicket>,
      select: TICKET_FIELDS_WITHOUT_MESSAGES,
      order: { createdAt: 'DESC' },
    })

    return this.paginateTickets(allRecords, query)
  }

  /**
   * Hàng đợi tickets cho staff/admin
   */
  async getTicketQueue(
    query: SupportTicketQueryDto,
    staffId?: string
  ): Promise<TicketListResult> {
    const where: Record<string, unknown> = {}
    if (query.status) where.status = query.status
    if (query.category) where.category = query.category
    if (query.priority) where.priority = query.priority
    if (staffId) where.assignedTo = staffId

    const allRecords = await this.ticketRepository.find({
      where: where as FindOptionsWhere<SupportTicket>,
      select: TICKET_FIELDS_WITHOUT_MESSAGES,
      order: { createdAt: 'DESC' },
    })

    // Filter SLA breach if requested
    let filtered = allRecords
    if (query.slaBreached === 'true') {
      const now = Date.now()
      filtered = allRecords.filter(
        t =>
          t.status !== 'resolved' &&
          t.status !== 'closed' &&
          new Date(t.slaDeadline).getTime() < now
      )
    }

    return this.paginateTickets(filtered, query)
  }

  /**
   * Chi tiết ticket + conversation thread
   */
  async getTicketDetail(
    ticketId: string,
    userId: string,
    userRole: string
  ): Promise<TicketDetailResult> {
    const ticket = await this.findTicketOrThrow(ticketId, true)

    // Access check: requester OR staff/admin
    const isStaffOrAdmin = ['staff', 'admin'].includes(userRole)
    if (!isStaffOrAdmin && ticket.requesterId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xem yêu cầu hỗ trợ này')
    }

    const messages = [...(ticket.messages ?? [])]
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
      .map(entry => toTicketMessage(String(ticket._id), entry))

    // Filter internal notes for non-staff
    const sanitizedMessages = isStaffOrAdmin
      ? messages
      : messages.filter(m => !m.isInternal)

    return { ticket: omitMessages(ticket), messages: sanitizedMessages }
  }

  /**
   * Gửi phản hồi / ghi chú vào ticket
   */
  async addMessage(
    ticketId: string,
    senderId: string,
    senderRole: string,
    dto: AddTicketMessageDto
  ): Promise<TicketMessage> {
    const ticket = await this.findTicketOrThrow(ticketId)

    const isStaffOrAdmin = ['staff', 'admin'].includes(senderRole)
    if (!isStaffOrAdmin && ticket.requesterId !== senderId) {
      throw new ForbiddenException('Bạn không có quyền phản hồi yêu cầu này')
    }

    if (dto.isInternal === true && !isStaffOrAdmin) {
      throw new ForbiddenException(
        'Chỉ nhân viên mới có thể thêm ghi chú nội bộ'
      )
    }

    if (ticket.status === 'closed') {
      throw new BadRequestException('Yêu cầu hỗ trợ này đã được đóng')
    }

    const now = new Date()
    const entry: TicketMessageEntry = {
      _id: new ObjectId(),
      senderId,
      senderRole,
      content: dto.content,
      attachmentUrls: dto.attachmentUrls ?? [],
      isInternal: dto.isInternal ?? false,
      createdAt: now,
    }

    // Update ticket timestamps and status (ghi cùng lúc với `$push`)
    const set: Partial<SupportTicket> = { updatedAt: now }
    if (isStaffOrAdmin && !dto.isInternal) {
      if (!ticket.firstResponseAt) {
        set.firstResponseAt = now
      }
      set.status = 'waiting_customer'
    } else if (!isStaffOrAdmin) {
      set.status = 'waiting_staff'
    }

    // Một `updateOne` nguyên tử: `$push` có trần, không ghi đè `messages`.
    const result = await this.ticketRepository.updateOne(
      {
        _id: ticket._id,
        [`messages.${MAX_TICKET_MESSAGES - 1}`]: { $exists: false },
      },
      {
        $push: { messages: entry } as unknown as PushOperator<Document>,
        $set: set as Document,
      }
    )
    if (result.matchedCount === 0) {
      throw new ConflictException(
        `Yêu cầu hỗ trợ đã đạt tối đa ${MAX_TICKET_MESSAGES} tin nhắn`
      )
    }

    // Notify recipient
    const recipientId = isStaffOrAdmin ? ticket.requesterId : ticket.assignedTo
    if (recipientId && !dto.isInternal) {
      await this.notificationsService.createNotification(
        recipientId,
        'Phản hồi hỗ trợ mới',
        `Có phản hồi mới cho yêu cầu #${ticketId}`,
        'SUPPORT_REPLY',
        { ticketId }
      )
    }

    return toTicketMessage(String(ticket._id), entry)
  }

  /**
   * Gán ticket cho staff
   */
  async assignTicket(
    ticketId: string,
    assignerId: string,
    dto: AssignTicketDto
  ): Promise<SupportTicket> {
    const ticket = await this.findTicketOrThrow(ticketId)

    ticket.assignedTo = dto.staffId
    ticket.assignedAt = new Date()
    if (ticket.status === 'open') {
      ticket.status = 'in_progress'
    }

    return this.updateFields(ticket, {
      assignedTo: ticket.assignedTo,
      assignedAt: ticket.assignedAt,
      status: ticket.status,
    })
  }

  /**
   * Leo thang (escalate) / chuyển tiếp ticket
   */
  async escalateTicket(
    ticketId: string,
    staffId: string,
    dto: EscalateTicketDto
  ): Promise<SupportTicket> {
    const ticket = await this.findTicketOrThrow(ticketId)

    const transfer: TransferHistoryItem = {
      fromStaffId: ticket.assignedTo ?? staffId,
      toStaffId: dto.toStaffId,
      transferredAt: new Date(),
      reason: dto.reason,
    }

    ticket.status = 'escalated'
    ticket.escalatedTo = dto.toStaffId
    ticket.escalatedAt = new Date()
    ticket.escalationReason = dto.reason
    ticket.assignedTo = dto.toStaffId
    ticket.transferHistory = [...(ticket.transferHistory ?? []), transfer]

    return this.updateFields(
      ticket,
      {
        status: ticket.status,
        escalatedTo: ticket.escalatedTo,
        escalatedAt: ticket.escalatedAt,
        escalationReason: ticket.escalationReason,
        assignedTo: ticket.assignedTo,
      },
      { transferHistory: transfer }
    )
  }

  /**
   * Giải quyết ticket (Staff/Admin)
   */
  async resolveTicket(
    ticketId: string,
    staffId: string,
    dto: ResolveTicketDto
  ): Promise<SupportTicket> {
    const ticket = await this.findTicketOrThrow(ticketId)

    ticket.status = 'resolved'
    ticket.resolvedAt = new Date()
    ticket.resolutionNote = dto.resolutionNote

    const updated = await this.updateFields(ticket, {
      status: ticket.status,
      resolvedAt: ticket.resolvedAt,
      resolutionNote: ticket.resolutionNote,
    })

    await this.notificationsService.createNotification(
      ticket.requesterId,
      'Yêu cầu hỗ trợ đã được giải quyết',
      `Yêu cầu #${ticketId} đã được xử lý. Vui lòng xác nhận đóng yêu cầu.`,
      'SUPPORT_RESOLVED',
      { ticketId }
    )

    return updated
  }

  /**
   * Đóng ticket (Requester confirm or Staff close)
   */
  async closeTicket(
    ticketId: string,
    userId: string,
    userRole: string
  ): Promise<SupportTicket> {
    const ticket = await this.findTicketOrThrow(ticketId)

    const isStaffOrAdmin = ['staff', 'admin'].includes(userRole)
    if (!isStaffOrAdmin && ticket.requesterId !== userId) {
      throw new ForbiddenException('Bạn không có quyền đóng yêu cầu này')
    }

    ticket.status = 'closed'
    ticket.closedAt = new Date()

    return this.updateFields(ticket, {
      status: ticket.status,
      closedAt: ticket.closedAt,
    })
  }

  // ─── Private Helpers ───────────────────────────────────

  /**
   * Ghi từng trường bằng `updateOne` (không `save` toàn document) để không bao
   * giờ ghi đè `messages[]` nhúng. `updatedAt` đặt tay vì bỏ qua TypeORM.
   */
  private async updateFields(
    ticket: SupportTicket,
    set: Partial<SupportTicket>,
    push?: Record<string, unknown>
  ): Promise<SupportTicket> {
    ticket.updatedAt = new Date()
    const update: UpdateFilter<Document> = {
      $set: { ...set, updatedAt: ticket.updatedAt } as Document,
    }
    if (push) update.$push = push as unknown as PushOperator<Document>
    await this.ticketRepository.updateOne({ _id: ticket._id }, update)
    return ticket
  }

  /** Mặc định chiếu bỏ `messages`; chỉ `getTicketDetail` nạp đầy đủ. */
  private async findTicketOrThrow(
    ticketId: string,
    includeMessages = false
  ): Promise<SupportTicket> {
    let ticket: SupportTicket | null = null
    try {
      ticket = await this.ticketRepository.findOne({
        where: { _id: new ObjectId(ticketId) },
        ...(includeMessages ? {} : { select: TICKET_FIELDS_WITHOUT_MESSAGES }),
      })
    } catch {
      throw new NotFoundException(`ID yêu cầu không hợp lệ: ${ticketId}`)
    }
    if (!ticket) {
      throw new NotFoundException(`Không tìm thấy yêu cầu hỗ trợ: ${ticketId}`)
    }
    return ticket
  }

  private paginateTickets(
    records: SupportTicket[],
    query: SupportTicketQueryDto
  ): TicketListResult {
    const total = records.length
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const totalPages = Math.ceil(total / limit)
    const skip = (page - 1) * limit
    const items = records.slice(skip, skip + limit).map(omitMessages)
    return { items, total, page, limit, totalPages }
  }
}
