import { Inject, Injectable, Logger } from '@nestjs/common'
import { Expo, ExpoPushMessage } from 'expo-server-sdk'
import { PushTokensService } from './push-tokens.service'

export const EXPO_CLIENT = Symbol('EXPO_CLIENT')

export type ExpoClient = Pick<
  Expo,
  'chunkPushNotifications' | 'sendPushNotificationsAsync'
>

export interface PushPayload {
  title: string
  body: string
  data?: Record<string, unknown>
}

const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name)

  constructor(
    private readonly pushTokensService: PushTokensService,
    @Inject(EXPO_CLIENT) private readonly expo: ExpoClient
  ) {}

  /**
   * Gửi push tới mọi thiết bị của user. Không bao giờ ném lỗi: push chỉ là
   * kênh phụ, thông báo đã được lưu trước đó.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    try {
      const tokens = (
        await this.pushTokensService.findTokensByUser(userId)
      ).filter(token => Expo.isExpoPushToken(token))
      if (tokens.length === 0) return

      const messages: ExpoPushMessage[] = tokens.map(to => ({
        to,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        ...(payload.data ? { data: payload.data } : {}),
      }))
      const chunks = this.expo.chunkPushNotifications(messages)
      const deadTokens = (
        await Promise.all(chunks.map(chunk => this.sendChunk(chunk)))
      ).flat()

      if (deadTokens.length > 0) {
        await this.pushTokensService.removeTokens(deadTokens)
      }
    } catch (error) {
      this.logger.warn(
        `Failed to send push notification: ${describeError(error)}`
      )
    }
  }

  /** Gửi một lô; trả về các token Expo báo đã chết. Lỗi lô chỉ ghi log. */
  private async sendChunk(chunk: ExpoPushMessage[]): Promise<string[]> {
    try {
      const tickets = await this.expo.sendPushNotificationsAsync(chunk)
      const dead: string[] = []
      tickets.forEach((ticket, index) => {
        if (ticket.status !== 'error') return
        if (ticket.details?.error === DEVICE_NOT_REGISTERED) {
          const to = chunk[index]?.to
          if (typeof to === 'string') dead.push(to)
          return
        }
        this.logger.warn(`Expo rejected a push message: ${ticket.message}`)
      })
      return dead
    } catch (error) {
      this.logger.warn(`Failed to send push chunk: ${describeError(error)}`)
      return []
    }
  }
}
