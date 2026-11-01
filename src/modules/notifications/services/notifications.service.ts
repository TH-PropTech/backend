import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { MongoRepository, Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Notification } from '../schemas/notification.schema'
import { User } from '../../users/schemas/user.schema'
import { NotificationQueryDto } from '../dto/notification-query.dto'
import {
  NOTIFICATIONS_PUBLISHER,
  NotificationsPublisher,
} from '../gateways/notifications.publisher'
import { PushService } from './push.service'

export interface NotificationListResult {
  items: Notification[]
  total: number
  page: number
  limit: number
  totalPages: number
}

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: MongoRepository<Notification>,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLISHER)
    private readonly publisher?: NotificationsPublisher,
    @Optional()
    private readonly pushService?: PushService,
    @Optional()
    @InjectRepository(User)
    private readonly userRepository?: Repository<User>
  ) {}

  private async getUser(userId: string): Promise<User | null> {
    if (!this.userRepository) return null
    try {
      if (ObjectId.isValid(userId)) {
        const byId = await this.userRepository.findOne({
          where: { _id: new ObjectId(userId) },
        })
        if (byId) return byId
      }
      return await this.userRepository.findOne({
        where: { _id: userId as never },
      })
    } catch {
      return null
    }
  }

  async isPushNotificationEnabled(userId: string): Promise<boolean> {
    const user = await this.getUser(userId)
    return user?.notificationPreferences?.push ?? true
  }

  async isEmailNotificationEnabled(userId: string): Promise<boolean> {
    const user = await this.getUser(userId)
    return user?.notificationPreferences?.email ?? true
  }

  /**
   * Đưa thông báo vừa lưu tới người nhận qua realtime và push. Hai kênh chạy
   * độc lập: kênh này lỗi không chặn kênh kia, và không làm thất bại việc tạo.
   */
  private async deliver(saved: Notification): Promise<void> {
    await Promise.all([this.publishCreated(saved), this.pushCreated(saved)])
  }

  private async pushCreated(saved: Notification): Promise<void> {
    if (!this.pushService) return

    const pushEnabled = await this.isPushNotificationEnabled(saved.userId)
    if (!pushEnabled) {
      this.logger.log(
        `Push notification disabled by user preferences for user ${saved.userId}`
      )
      return
    }

    try {
      await this.pushService.sendToUser(saved.userId, {
        title: saved.title,
        body: saved.body,
        data: saved.data,
      })
    } catch (error) {
      this.logger.warn(
        `Failed to push notification: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      )
    }
  }

  /**
   * Phát thông báo mới qua realtime. Lỗi ở đây không được làm thất bại việc
   * tạo thông báo (đã lưu xong), nên chỉ ghi log.
   */
  private async publishCreated(saved: Notification): Promise<void> {
    if (!this.publisher) return
    try {
      const { count } = await this.getUnreadCount(saved.userId)
      await this.publisher.publish({
        userId: saved.userId,
        unreadCount: count,
        notification: {
          _id: String(saved._id),
          title: saved.title,
          body: saved.body,
          type: saved.type,
          isRead: saved.isRead,
          data: saved.data,
          createdAt: saved.createdAt.toISOString(),
        },
      })
    } catch (error) {
      this.logger.warn(
        `Failed to publish notification in realtime: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      )
    }
  }

  private toObjectId(id: string): ObjectId {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException(`ID thông báo không hợp lệ: ${id}`)
    }
    return new ObjectId(id)
  }

  /**
   * Tạo và lưu thông báo mới vào database
   */
  async createNotification(
    userId: string,
    title: string,
    body: string,
    type: string,
    data: Record<string, unknown> = {}
  ): Promise<Notification> {
    this.logger.log(`Creating notification of type ${type} for user ${userId}`)
    const notification = this.notificationRepository.create({
      userId,
      title,
      body,
      type,
      data,
      isRead: false,
    })
    const saved = await this.notificationRepository.save(notification)
    await this.deliver(saved)
    return saved
  }

  /**
   * Tạo thông báo nếu user chưa nhận `dedupeKey` này; trả `null` khi đã có.
   * ponytail: find-then-insert không có unique index, hai request đồng thời
   * có thể cùng tạo; thêm unique (userId, dedupeKey) khi cần chặt hơn.
   */
  async createNotificationOnce(
    userId: string,
    dedupeKey: string,
    title: string,
    body: string,
    type: string,
    data: Record<string, unknown> = {}
  ): Promise<Notification | null> {
    const existing = await this.notificationRepository.findOne({
      where: { userId, dedupeKey },
    })
    if (existing) return null
    const notification = this.notificationRepository.create({
      userId,
      title,
      body,
      type,
      data,
      dedupeKey,
      isRead: false,
    })
    const saved = await this.notificationRepository.save(notification)
    await this.deliver(saved)
    return saved
  }

  /**
   * Lấy danh sách thông báo của người dùng kèm phân trang và lọc trạng thái
   */
  async getUserNotifications(
    userId: string,
    query: NotificationQueryDto
  ): Promise<NotificationListResult> {
    this.logger.log(`Fetching notifications for user ${userId}`)

    const where: Record<string, unknown> = { userId }
    if (query.isRead !== undefined) {
      where.isRead = query.isRead === 'true'
    }

    const page = query.page ?? DEFAULT_PAGE
    const limit = query.limit ?? DEFAULT_LIMIT
    const [items, total] = await this.notificationRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    })

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  /**
   * Tổng số thông báo chưa đọc của user (không phụ thuộc phân trang)
   */
  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.notificationRepository.countDocuments({
      userId,
      isRead: false,
    })
    return { count }
  }

  /**
   * Đánh dấu 1 thông báo đã đọc
   */
  async markAsRead(id: string, userId: string): Promise<Notification> {
    this.logger.log(`Marking notification ${id} as read for user ${userId}`)
    const notification = await this.notificationRepository.findOne({
      where: { _id: this.toObjectId(id) },
    })

    if (!notification) {
      throw new NotFoundException(`Không tìm thấy thông báo: ${id}`)
    }

    if (notification.userId !== userId) {
      throw new NotFoundException(`Không tìm thấy thông báo của người dùng`)
    }

    notification.isRead = true
    return this.notificationRepository.save(notification)
  }

  /**
   * Đánh dấu toàn bộ thông báo của người dùng là đã đọc
   */
  async markAllAsRead(userId: string): Promise<void> {
    this.logger.log(`Marking all notifications as read for user ${userId}`)
    await this.notificationRepository.updateMany(
      { userId, isRead: false },
      { $set: { isRead: true } }
    )
  }

  /**
   * Xóa 1 thông báo của chính user; 404 khi không có hoặc thuộc user khác
   */
  async deleteNotification(id: string, userId: string): Promise<void> {
    this.logger.log(`Deleting notification ${id} for user ${userId}`)
    const result = await this.notificationRepository.deleteOne({
      _id: this.toObjectId(id),
      userId,
    })
    if (!result.deletedCount) {
      throw new NotFoundException(`Không tìm thấy thông báo: ${id}`)
    }
  }

  /**
   * Cập nhật trạng thái thông báo đặt lịch (đã đọc và lưu status mới)
   */
  async updateBookingNotificationStatus(
    bookingId: string,
    status: 'confirmed' | 'rejected' | 'cancelled' | 'completed'
  ): Promise<void> {
    this.logger.log(
      `Updating notifications for booking ${bookingId} to status ${status}`
    )
    // bookingId luôn lưu dạng chuỗi (bookings.service: String(saved._id)).
    await this.notificationRepository.updateMany(
      { type: 'BOOKING', 'data.bookingId': bookingId },
      { $set: { isRead: true, 'data.status': status } }
    )
  }
}
