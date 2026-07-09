import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import { Server, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Logger } from '@nestjs/common'
import { AiChatsService } from './services/ai-chats.service'

interface ClientSession {
  userId?: string
  deviceId?: string
}

@WebSocketGateway({ path: '/ws/ai-chats' })
export class AiChatsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AiChatsGateway.name)
  private readonly sessions = new Map<WebSocket, ClientSession>()

  @WebSocketServer()
  server!: Server

  constructor(private readonly aiChatsService: AiChatsService) {}

  async handleConnection(
    client: WebSocket,
    request: IncomingMessage
  ): Promise<void> {
    const url = request.url || ''
    const query = url.split('?')[1] || ''
    const params = new URLSearchParams(query)
    const userId = params.get('userId') || undefined
    const deviceId = params.get('deviceId') || undefined

    if (!userId && !deviceId) {
      client.close(4001, 'Either userId or deviceId is required')
      return
    }

    const session: ClientSession = { userId, deviceId }
    this.sessions.set(client, session)
    this.logger.log(
      `Client connected to /ws/ai-chats. Session: ${JSON.stringify(session)}`
    )

    try {
      const greeting = `Xin chào! Tôi là Trợ lý ảo TH-PropTech. Tôi có thể giúp gì cho bạn hôm nay? Bạn có thể nhờ tôi tìm kiếm căn hộ hoặc lên lịch đặt lịch hẹn xem phòng.`

      const chat = await this.aiChatsService.getOrCreateSession({
        userId,
        deviceId,
      })
      if (chat.messages.length === 0) {
        await this.aiChatsService.addMessage(
          { userId, deviceId },
          'assistant',
          greeting
        )
      }

      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            event: 'message_complete',
            data: {
              text: greeting,
            },
          })
        )
      }
    } catch (err) {
      this.logger.error('Error sending greeting:', err)
    }
  }

  handleDisconnect(client: WebSocket): void {
    this.sessions.delete(client)
    this.logger.log('Client disconnected from /ws/ai-chats')
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: { text?: string }
  ): Promise<void> {
    const session = this.sessions.get(client)
    if (!session || !data.text) return

    const { userId, deviceId } = session
    this.logger.log(
      `Received send_message from session: ${JSON.stringify(session)}, content: "${data.text}"`
    )

    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event: 'typing' }))
    }

    try {
      const result = await this.aiChatsService.handleUserMessage(
        { userId, deviceId },
        data.text,
        chunkText => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                event: 'message_chunk',
                data: { text: chunkText },
              })
            )
          }
        }
      )

      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            event: 'message_complete',
            data: {
              text: result.content,
              metadata: result.metadata,
            },
          })
        )
      }
    } catch (err) {
      this.logger.error('Error handling send_message:', err)
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            event: 'thinking_failed',
            data: { error: 'Có lỗi xảy ra khi xử lý tin nhắn của bạn.' },
          })
        )
      }
    }
  }
}
