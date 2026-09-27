import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, FindOptionsWhere } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Notification } from './schemas/notification.schema'
import { NotificationQueryDto } from './dto/notification-query.dto'

export interface NotificationListResult {
  items: Notification[]
  total: number
  page: number
  limit: number
  totalPages: number
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>
  ) {}

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
    return this.notificationRepository.save(notification)
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
    return this.notificationRepository.save(notification)
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

    const allRecords = await this.notificationRepository.find({
      where: where as FindOptionsWhere<Notification>,
      order: { createdAt: 'DESC' },
    })

    const total = allRecords.length
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const totalPages = Math.ceil(total / limit)
    const skip = (page - 1) * limit
    const items = allRecords.slice(skip, skip + limit)

    return { items, total, page, limit, totalPages }
  }

  /**
   * Đánh dấu 1 thông báo đã đọc
   */
  async markAsRead(id: string, userId: string): Promise<Notification> {
    this.logger.log(`Marking notification ${id} as read for user ${userId}`)
    let notification: Notification | null = null
    try {
      notification = await this.notificationRepository.findOne({
        where: { _id: new ObjectId(id) },
      })
    } catch {
      throw new NotFoundException(`ID thông báo không hợp lệ: ${id}`)
    }

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
    const unread = await this.notificationRepository.find({
      where: { userId, isRead: false } as FindOptionsWhere<Notification>,
    })

    if (unread.length > 0) {
      for (const notif of unread) {
        notif.isRead = true
      }
      await this.notificationRepository.save(unread)
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
    const notifications = await this.notificationRepository.find({
      where: { type: 'BOOKING' } as FindOptionsWhere<Notification>,
    })

    for (const notif of notifications) {
      if (notif.data && String(notif.data.bookingId) === bookingId) {
        notif.isRead = true
        notif.data = {
          ...notif.data,
          status,
        }
        await this.notificationRepository.save(notif)
      }
    }
  }
}
