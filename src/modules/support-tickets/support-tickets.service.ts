import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, FindOptionsWhere } from 'typeorm'
import { ObjectId } from 'mongodb'
import {
  SupportTicket,
  TicketPriority,
  TransferHistoryItem,
} from './schemas/support-ticket.schema'
import { TicketMessage } from './schemas/ticket-message.schema'
import {
  CreateSupportTicketDto,
  AddTicketMessageDto,
  AssignTicketDto,
  EscalateTicketDto,
  ResolveTicketDto,
  SupportTicketQueryDto,
} from './dto/support-ticket.dto'
import { NotificationsService } from '../notifications/notifications.service'

/** SLA deadlines by priority (in hours) */
const SLA_HOURS: Record<TicketPriority, number> = {
  low: 72,
  normal: 24,
  high: 8,
  urgent: 4,
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
    private readonly ticketRepository: Repository<SupportTicket>,
    @InjectRepository(TicketMessage)
    private readonly messageRepository: Repository<TicketMessage>,
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
    }
    if (dto.linkedEntityType) ticketData.linkedEntityType = dto.linkedEntityType
    if (dto.linkedEntityId) ticketData.linkedEntityId = dto.linkedEntityId

    const ticket = this.ticketRepository.create(ticketData)

    const saved = await this.ticketRepository.save(ticket)

    // Create initial message from description
    const message = this.messageRepository.create({
      ticketId: String(saved._id),
      senderId: requesterId,
      senderRole: requesterRole,
      content: dto.description,
      attachmentUrls: [],
      isInternal: false,
    })
    await this.messageRepository.save(message)

    // Notify staff
    await this.notificationsService.createNotification(
      'staff',
      'Yêu cầu hỗ trợ mới',
      `[${priority.toUpperCase()}] ${dto.subject}`,
      'SUPPORT_TICKET',
      { ticketId: String(saved._id), category: dto.category, priority }
    )

    return saved
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
    const ticket = await this.findTicketOrThrow(ticketId)

    // Access check: requester OR staff/admin
    const isStaffOrAdmin = ['staff', 'admin'].includes(userRole)
    if (!isStaffOrAdmin && ticket.requesterId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xem yêu cầu hỗ trợ này')
    }

    const messages = await this.messageRepository.find({
      where: { ticketId } as FindOptionsWhere<TicketMessage>,
      order: { createdAt: 'ASC' },
    })

    // Filter internal notes for non-staff
    const sanitizedMessages = isStaffOrAdmin
      ? messages
      : messages.filter(m => !m.isInternal)

    return { ticket, messages: sanitizedMessages }
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

    const message = this.messageRepository.create({
      ticketId,
      senderId,
      senderRole,
      content: dto.content,
      attachmentUrls: dto.attachmentUrls ?? [],
      isInternal: dto.isInternal ?? false,
    })

    const savedMessage = await this.messageRepository.save(message)

    // Update ticket timestamps and status
    if (isStaffOrAdmin && !dto.isInternal) {
      if (!ticket.firstResponseAt) {
        ticket.firstResponseAt = new Date()
      }
      ticket.status = 'waiting_customer'
    } else if (!isStaffOrAdmin) {
      ticket.status = 'waiting_staff'
    }

    await this.ticketRepository.save(ticket)

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

    return savedMessage
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

    return this.ticketRepository.save(ticket)
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

    return this.ticketRepository.save(ticket)
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

    const updated = await this.ticketRepository.save(ticket)

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

    return this.ticketRepository.save(ticket)
  }

  // ─── Private Helpers ───────────────────────────────────

  private async findTicketOrThrow(ticketId: string): Promise<SupportTicket> {
    let ticket: SupportTicket | null = null
    try {
      ticket = await this.ticketRepository.findOne({
        where: { _id: new ObjectId(ticketId) },
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
    const items = records.slice(skip, skip + limit)
    return { items, total, page, limit, totalPages }
  }
}
