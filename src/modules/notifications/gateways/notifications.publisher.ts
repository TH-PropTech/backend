export const NOTIFICATIONS_PUBLISHER = Symbol('NOTIFICATIONS_PUBLISHER')

/** Hình dạng thông báo gửi qua WebSocket; cùng khóa với JSON của REST. */
export type NotificationPayload = Readonly<{
  _id: string
  title: string
  body: string
  type: string
  isRead: boolean
  data: Record<string, unknown>
  createdAt: string
}>

export type NotificationCreatedEvent = Readonly<{
  userId: string
  notification: NotificationPayload
  unreadCount: number
}>

export interface NotificationsPublisher {
  publish(event: NotificationCreatedEvent): Promise<void>
}
