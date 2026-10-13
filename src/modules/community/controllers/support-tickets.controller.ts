import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import {
  SupportTicketsService,
  TicketListResult,
  TicketDetailResult,
} from '../services/support-tickets.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import {
  CreateSupportTicketDto,
  AddTicketMessageDto,
  AssignTicketDto,
  EscalateTicketDto,
  ResolveTicketDto,
  SupportTicketQueryDto,
} from '../dto/support-ticket.dto'
import { SupportTicket } from '../schemas/support-ticket.schema'
import { TicketMessage } from '../schemas/ticket-message.schema'
import { UserPayload } from '../../auth/interfaces/auth.interface'

@ApiTags('support-tickets')
@Controller('support-tickets')
@UseGuards(JwtAuthGuard)
export class SupportTicketsController {
  constructor(private readonly supportTicketsService: SupportTicketsService) {}

  /**
   * POST /api/v1/support-tickets
   * Tạo yêu cầu hỗ trợ mới kèm tính SLA tự động
   * [uc_support_ticket_create]
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateSupportTicketDto,
    @CurrentUser('id') userId: string,
    @Request() req: { user: UserPayload }
  ): Promise<SupportTicket> {
    const role = req.user.roles?.[0] ?? 'tenant'
    return this.supportTicketsService.createTicket(userId, role, dto)
  }

  /**
   * GET /api/v1/support-tickets/my
   * Lấy danh sách yêu cầu hỗ trợ của tôi
   */
  @Get('my')
  async getMyTickets(
    @CurrentUser('id') userId: string,
    @Query() query: SupportTicketQueryDto
  ): Promise<TicketListResult> {
    return this.supportTicketsService.getMyTickets(userId, query)
  }

  /**
   * GET /api/v1/support-tickets/queue
   * Hàng đợi yêu cầu hỗ trợ cho staff/admin
   */
  @Get('queue')
  @Roles('staff', 'admin')
  @UseGuards(RolesGuard)
  async getQueue(
    @Query() query: SupportTicketQueryDto
  ): Promise<TicketListResult> {
    return this.supportTicketsService.getTicketQueue(query)
  }

  /**
   * GET /api/v1/support-tickets/:id
   * Chi tiết yêu cầu hỗ trợ + luồng trao đổi
   */
  @Get(':id')
  async getDetail(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Request() req: { user: UserPayload }
  ): Promise<TicketDetailResult> {
    const role = req.user.roles?.[0] ?? 'tenant'
    return this.supportTicketsService.getTicketDetail(id, userId, role)
  }

  /**
   * POST /api/v1/support-tickets/:id/messages
   * Gửi tin nhắn / phản hồi mới
   */
  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  async addMessage(
    @Param('id') id: string,
    @Body() dto: AddTicketMessageDto,
    @CurrentUser('id') userId: string,
    @Request() req: { user: UserPayload }
  ): Promise<TicketMessage> {
    const role = req.user.roles?.[0] ?? 'tenant'
    return this.supportTicketsService.addMessage(id, userId, role, dto)
  }

  /**
   * PATCH /api/v1/support-tickets/:id/assign
   * Gán nhân viên xử lý
   */
  @Patch(':id/assign')
  @Roles('staff', 'admin')
  @UseGuards(RolesGuard)
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser('id') staffId: string
  ): Promise<SupportTicket> {
    return this.supportTicketsService.assignTicket(id, staffId, dto)
  }

  /**
   * PATCH /api/v1/support-tickets/:id/escalate
   * Leo thang / chuyển giao ticket
   */
  @Patch(':id/escalate')
  @Roles('staff', 'admin')
  @UseGuards(RolesGuard)
  async escalate(
    @Param('id') id: string,
    @Body() dto: EscalateTicketDto,
    @CurrentUser('id') staffId: string
  ): Promise<SupportTicket> {
    return this.supportTicketsService.escalateTicket(id, staffId, dto)
  }

  /**
   * PATCH /api/v1/support-tickets/:id/resolve
   * Đánh dấu đã giải quyết (Staff/Admin)
   */
  @Patch(':id/resolve')
  @Roles('staff', 'admin')
  @UseGuards(RolesGuard)
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveTicketDto,
    @CurrentUser('id') staffId: string
  ): Promise<SupportTicket> {
    return this.supportTicketsService.resolveTicket(id, staffId, dto)
  }

  /**
   * PATCH /api/v1/support-tickets/:id/close
   * Đóng ticket
   */
  @Patch(':id/close')
  @HttpCode(HttpStatus.OK)
  async close(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Request() req: { user: UserPayload }
  ): Promise<SupportTicket> {
    const role = req.user.roles?.[0] ?? 'tenant'
    return this.supportTicketsService.closeTicket(id, userId, role)
  }
}
