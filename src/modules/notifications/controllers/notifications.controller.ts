import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import {
  NotificationsService,
  NotificationListResult,
} from '../services/notifications.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { NotificationQueryDto } from '../dto/notification-query.dto'
import { RegisterPushTokenDto } from '../dto/register-push-token.dto'
import { PushTokensService } from '../services/push-tokens.service'
import { UserPayload } from '../../auth/interfaces/auth.interface'
import { Notification } from '../schemas/notification.schema'

type AuthedRequest = { user: UserPayload }

function requireUserId(req: AuthedRequest): string {
  const userId = req.user._id
  if (!userId) throw new Error('Không thể xác thực người dùng')
  return userId
}

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushTokensService: PushTokensService
  ) {}

  /**
   * POST /api/v1/notifications/push-tokens
   * Đăng ký token thiết bị để nhận push (idempotent)
   */
  @Post('push-tokens')
  @HttpCode(HttpStatus.OK)
  async registerPushToken(
    @Request() req: AuthedRequest,
    @Body() dto: RegisterPushTokenDto
  ): Promise<{ success: boolean }> {
    await this.pushTokensService.register(requireUserId(req), dto)
    return { success: true }
  }

  /**
   * DELETE /api/v1/notifications/push-tokens/:token
   * Hủy token thiết bị (đăng xuất); client phải encodeURIComponent token
   */
  @Delete('push-tokens/:token')
  @HttpCode(HttpStatus.OK)
  async unregisterPushToken(
    @Param('token') token: string,
    @Request() req: AuthedRequest
  ): Promise<{ success: boolean }> {
    await this.pushTokensService.unregister(requireUserId(req), token)
    return { success: true }
  }

  /**
   * GET /api/v1/notifications
   * Lấy danh sách thông báo của người dùng hiện tại
   */
  @Get()
  async getNotifications(
    @Request() req: AuthedRequest,
    @Query() query: NotificationQueryDto
  ): Promise<NotificationListResult> {
    return this.notificationsService.getUserNotifications(
      requireUserId(req),
      query
    )
  }

  /**
   * GET /api/v1/notifications/unread-count
   * Tổng số thông báo chưa đọc (dùng cho badge, không phụ thuộc phân trang)
   */
  @Get('unread-count')
  async getUnreadCount(
    @Request() req: AuthedRequest
  ): Promise<{ count: number }> {
    return this.notificationsService.getUnreadCount(requireUserId(req))
  }

  /**
   * PATCH /api/v1/notifications/read-all
   * Đánh dấu tất cả thông báo là đã đọc
   */
  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(
    @Request() req: AuthedRequest
  ): Promise<{ success: boolean }> {
    await this.notificationsService.markAllAsRead(requireUserId(req))
    return { success: true }
  }

  /**
   * PATCH /api/v1/notifications/:id/read
   * Đánh dấu 1 thông báo là đã đọc
   */
  @Patch(':id/read')
  async markRead(
    @Param('id') id: string,
    @Request() req: AuthedRequest
  ): Promise<Notification> {
    return this.notificationsService.markAsRead(id, requireUserId(req))
  }

  /**
   * DELETE /api/v1/notifications/:id
   * Xóa 1 thông báo của chính người dùng
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id') id: string,
    @Request() req: AuthedRequest
  ): Promise<{ success: boolean }> {
    await this.notificationsService.deleteNotification(id, requireUserId(req))
    return { success: true }
  }
}
