import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectRepository } from '@nestjs/typeorm'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { WebSocket } from 'ws'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import type {
  SmartCaEventsPublisher,
  SmartCaSessionUpdatedEvent,
} from './smartca-events.publisher'
import { SmartCaSigningSession } from './smartca-signing-session.schema'

const AUTH_TIMEOUT_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 30_000
const MAX_SUBSCRIPTIONS = 5

type ClientSession = {
  authTimeout: ReturnType<typeof setTimeout>
  subscriptions: Set<string>
  userId?: string
  isAlive: boolean
}

type AuthMessage = { token?: unknown }
type SubscriptionMessage = { contractId?: unknown; sessionId?: unknown }

@Injectable()
@WebSocketGateway({ path: '/ws/contracts/smartca' })
export class SmartCaEventsGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    OnApplicationShutdown,
    SmartCaEventsPublisher
{
  private readonly logger = new Logger(SmartCaEventsGateway.name)
  private readonly clients = new Map<WebSocket, ClientSession>()
  private heartbeat?: ReturnType<typeof setInterval>

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(SmartCaSigningSession)
    private readonly sessionRepository: Repository<SmartCaSigningSession>
  ) {}

  afterInit(): void {
    this.heartbeat = setInterval(
      () => this.runHeartbeat(),
      HEARTBEAT_INTERVAL_MS
    )
  }

  handleConnection(client: WebSocket): void {
    const authTimeout = setTimeout(() => {
      const session = this.clients.get(client)
      if (!session?.userId) this.closeUnauthorized(client)
    }, AUTH_TIMEOUT_MS)

    this.clients.set(client, {
      authTimeout,
      subscriptions: new Set<string>(),
      isAlive: true,
    })
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
      this.logger.warn('Rejected invalid SmartCA realtime authentication')
      this.closeUnauthorized(client)
    }
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: SubscriptionMessage
  ): Promise<void> {
    const session = this.clients.get(client)
    if (!session?.userId) {
      this.closeUnauthorized(client)
      return
    }
    if (
      typeof data?.contractId !== 'string' ||
      typeof data.sessionId !== 'string' ||
      !ObjectId.isValid(data.sessionId)
    ) {
      this.sendError(client, 'SMARTCA_SUBSCRIPTION_FORBIDDEN')
      return
    }
    if (
      !session.subscriptions.has(data.sessionId) &&
      session.subscriptions.size >= MAX_SUBSCRIPTIONS
    ) {
      this.sendError(client, 'SMARTCA_SUBSCRIPTION_LIMIT_REACHED')
      return
    }

    const ownedSession = await this.sessionRepository.findOne({
      where: {
        _id: new ObjectId(data.sessionId),
        contractId: data.contractId,
        signerId: session.userId,
      },
    })
    if (!ownedSession) {
      this.sendError(client, 'SMARTCA_SUBSCRIPTION_FORBIDDEN')
      return
    }

    session.subscriptions.add(data.sessionId)
    this.send(client, {
      event: 'subscribed',
      data: { sessionId: data.sessionId },
    })
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: SubscriptionMessage
  ): void {
    if (typeof data?.sessionId !== 'string') return
    this.clients.get(client)?.subscriptions.delete(data.sessionId)
  }

  publish(event: SmartCaSessionUpdatedEvent): Promise<void> {
    for (const [client, session] of this.clients) {
      if (session.userId && session.subscriptions.has(event.sessionId)) {
        this.send(client, { event: 'smartca.session.updated', data: event })
      }
    }
    return Promise.resolve()
  }

  onApplicationShutdown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    for (const client of this.clients.keys()) client.terminate()
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
    client.close(4401, 'Unauthorized')
    this.handleDisconnect(client)
  }

  private sendError(client: WebSocket, code: string): void {
    this.send(client, { event: 'error', data: { code } })
  }

  private send(client: WebSocket, message: object): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message))
    }
  }
}
