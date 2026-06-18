import {
  Controller,
  Get,
  Patch,
  Param,
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
} from './notifications.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { NotificationQueryDto } from './dto/notification-query.dto'
import { UserPayload } from '../auth/interfaces/auth.interface'
import { Notification } from './schemas/notification.schema'

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /api/v1/notifications
   * Lấy danh sách thông báo của người dùng hiện tại
   */
  @Get()
  async getNotifications(
    @Request() req: { user: UserPayload },
    @Query() query: NotificationQueryDto
  ): Promise<NotificationListResult> {
    const userId = req.user._id
    if (!userId) throw new Error('Không thể xác thực người dùng')
    return this.notificationsService.getUserNotifications(userId, query)
  }

  /**
   * PATCH /api/v1/notifications/read-all
   * Đánh dấu tất cả thông báo là đã đọc
   */
  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(
    @Request() req: { user: UserPayload }
  ): Promise<{ success: boolean }> {
    const userId = req.user._id
    if (!userId) throw new Error('Không thể xác thực người dùng')
    await this.notificationsService.markAllAsRead(userId)
    return { success: true }
  }

  /**
   * PATCH /api/v1/notifications/:id/read
   * Đánh dấu 1 thông báo là đã đọc
   */
  @Patch(':id/read')
  async markRead(
    @Param('id') id: string,
    @Request() req: { user: UserPayload }
  ): Promise<Notification> {
    const userId = req.user._id
    if (!userId) throw new Error('Không thể xác thực người dùng')
    return this.notificationsService.markAsRead(id, userId)
  }
}
