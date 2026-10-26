import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets'
import { WebSocket } from 'ws'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import type {
  NotificationCreatedEvent,
  NotificationsPublisher,
} from './notifications.publisher'

const AUTH_TIMEOUT_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 30_000
const UNAUTHORIZED_CLOSE_CODE = 4401

type ClientSession = {
  authTimeout: ReturnType<typeof setTimeout>
  userId?: string
  isAlive: boolean
}

type AuthMessage = { token?: unknown }

@Injectable()
@WebSocketGateway({ path: '/ws/notifications' })
export class NotificationsGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    OnApplicationShutdown,
    NotificationsPublisher
{
  private readonly logger = new Logger(NotificationsGateway.name)
  private readonly clients = new Map<WebSocket, ClientSession>()
  private heartbeat: ReturnType<typeof setInterval> | undefined

  constructor(private readonly jwtService: JwtService) {}

  afterInit(): void {
    this.heartbeat = setInterval(
      () => this.runHeartbeat(),
      HEARTBEAT_INTERVAL_MS
    )
  }

  handleConnection(client: WebSocket): void {
    const authTimeout = setTimeout(() => {
      if (!this.clients.get(client)?.userId) this.closeUnauthorized(client)
    }, AUTH_TIMEOUT_MS)

    this.clients.set(client, { authTimeout, isAlive: true })
    client.on('pong', () => {
      const session = this.clients.get(client)
      if (session) session.isAlive = true
    })
  }

  handleDisconnect(client: WebSocket): void {
    const session = this.clients.get(client)
    if (session) clearTimeout(session.authTimeout)
    this.clients.delete(client)
  }

  @SubscribeMessage('auth')
  handleAuth(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: AuthMessage
  ): void {
    const session = this.clients.get(client)
    if (!session || typeof data?.token !== 'string') {
      this.closeUnauthorized(client)
      return
    }

    try {
      const payload = this.jwtService.verify<UserPayload>(data.token)
      if (!payload._id) {
        this.closeUnauthorized(client)
        return
      }
      clearTimeout(session.authTimeout)
      session.userId = payload._id
    } catch {
      // Không ghi token hay nội dung lỗi vì có thể chứa phần của token.
      this.logger.warn('Rejected invalid notification realtime authentication')
      this.closeUnauthorized(client)
    }
  }

  publish(event: NotificationCreatedEvent): Promise<void> {
    const message = JSON.stringify({
      event: 'notification.created',
      data: {
        notification: event.notification,
        unreadCount: event.unreadCount,
      },
    })
    for (const [client, session] of this.clients) {
      if (session.userId === event.userId) this.send(client, message)
    }
    return Promise.resolve()
  }

  onApplicationShutdown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    for (const [client, session] of this.clients) {
      clearTimeout(session.authTimeout)
      client.terminate()
    }
    this.clients.clear()
  }

  private runHeartbeat(): void {
    for (const [client, session] of this.clients) {
      if (!session.isAlive) {
        client.terminate()
        this.handleDisconnect(client)
        continue
      }
      session.isAlive = false
      client.ping()
    }
  }

  private closeUnauthorized(client: WebSocket): void {
    client.close(UNAUTHORIZED_CLOSE_CODE, 'Unauthorized')
    this.handleDisconnect(client)
  }

  private send(client: WebSocket, message: string): void {
    if (client.readyState !== WebSocket.OPEN) return
    try {
      client.send(message)
    } catch (error) {
      this.logger.warn(
        `Failed to deliver notification to a socket: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      )
    }
  }
}
