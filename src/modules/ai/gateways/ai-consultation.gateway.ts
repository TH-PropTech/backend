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
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { AiConsultationLog } from '../schemas/ai-consultation-log.schema'
import { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import { KindScopedActivityLogRepository } from '../../activity-log/utils/kind-scoped-activity-log.repository'
import { toAiConsultationLog } from '../../activity-log/utils/legacy-log.mapper'
import { AiConsultationService } from '../services/ai-consultation.service'
import { SttService } from '../services/stt.service'
import { TtsService } from '../services/tts.service'
import { VadService } from '../services/vad.service'
import { GroqLlmService } from '../services/groq-llm.service'

interface ClientSession {
  logId: string
  startTime: number
  hasGreeted: boolean
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
}

@WebSocketGateway({ path: '/ws/ai-consultation' })
export class AiConsultationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AiConsultationGateway.name)
  private readonly sessions = new Map<WebSocket, ClientSession>()

  @WebSocketServer()
  server!: Server

  private readonly logRepository: KindScopedActivityLogRepository<AiConsultationLog>

  constructor(
    @InjectRepository(ActivityLog)
    activityLogRepository: Repository<ActivityLog>,
    private readonly consultationService: AiConsultationService,
    private readonly sttService: SttService,
    private readonly ttsService: TtsService,
    private readonly vadService: VadService,
    private readonly groqLlmService: GroqLlmService
  ) {
    this.logRepository = new KindScopedActivityLogRepository(
      activityLogRepository,
      'ai-consultation',
      toAiConsultationLog
    )
  }

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const url = request.url || ''
    const query = url.split('?')[1] || ''
    const params = new URLSearchParams(query)
    const logId = params.get('logId') || ''

    if (!logId) {
      client.close(4001, 'logId is required')
      return
    }

    const session: ClientSession = {
      logId,
      startTime: Date.now(),
      hasGreeted: false,
      messages: [],
    }

    this.sessions.set(client, session)

    void this.greetIfSessionOpen(client, session)
  }

  /** Unknown or finished sessions are closed instead of greeted, so a random logId cannot start a call. */
  private async greetIfSessionOpen(
    client: WebSocket,
    session: ClientSession
  ): Promise<void> {
    let open = false
    try {
      open = await this.consultationService.isSessionOpen(session.logId)
    } catch (err) {
      this.logger.error(
        `Could not verify session ${session.logId}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    if (!open) {
      this.sessions.delete(client)
      client.close(4003, 'session is not available')
      return
    }
    await this.sendGreeting(client, session)
  }

  handleDisconnect(client: WebSocket): void {
    const session = this.sessions.get(client)
    if (!session) return

    const duration = Math.floor((Date.now() - session.startTime) / 1000)
    void this.consultationService.completeSession(session.logId, duration)

    this.sttService.clearAudio(session.logId)
    this.vadService.clear(session.logId)
    this.sessions.delete(client)
    this.logger.log(
      `Session ${session.logId} disconnected. Duration: ${duration}s`
    )
  }

  @SubscribeMessage('media')
  handleMedia(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: { media?: { payload?: string } }
  ): void {
    const session = this.sessions.get(client)
    if (!session || !data.media?.payload) return

    const pcmBuffer = Buffer.from(data.media.payload, 'base64')
    this.sttService.appendAudio(session.logId, pcmBuffer)
    this.vadService.processChunk(session.logId, pcmBuffer)

    if (this.vadService.isSilent(session.logId)) {
      this.vadService.reset(session.logId)
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event: 'thinking' }))
      }
      void this.processSpeechTurn(client, session)
    }
  }

  @SubscribeMessage('test_text')
  async handleTestText(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: { text?: string }
  ): Promise<void> {
    const session = this.sessions.get(client)
    if (!session || !data.text) return

    session.messages.push({ role: 'user', content: data.text })
    this.logger.log(`[Session ${session.logId}] 📝 User (Text): "${data.text}"`)
    await this.consultationService.addMessage(session.logId, 'user', data.text)

    client.send(
      JSON.stringify({
        event: 'text_reply',
        text: `Khách hàng: ${data.text}`,
      })
    )

    try {
      await this.generateAndSendReply(client, session)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const errStack = err instanceof Error ? err.stack : ''
      this.logger.error(
        `[Session ${session.logId}] ❌ Failed to generate reply for test text: ${errMsg}\n${errStack}`
      )
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event: 'thinking_failed' }))
      }
    }
  }

  @SubscribeMessage('stop')
  handleStop(@ConnectedSocket() client: WebSocket): void {
    client.close(1000, 'Client requested stop')
  }

  private async sendGreeting(
    client: WebSocket,
    session: ClientSession
  ): Promise<void> {
    const greeting =
      'Xin chào! Tôi là Trợ lý ảo tư vấn căn hộ TH PropTech. Bạn có thể dành một chút thời gian để nghe tư vấn thuê căn hộ được không ạ?'

    session.messages.push({ role: 'assistant', content: greeting })
    this.logger.log(
      `[Session ${session.logId}] 🎙️ Greeting sent: "${greeting}"`
    )
    await this.consultationService.addMessage(
      session.logId,
      'assistant',
      greeting
    )

    const audio = await this.ttsService.textToSpeech(greeting)
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          event: 'chunk',
          media: { payload: audio, format: 'mp3' },
        })
      )
      client.send(JSON.stringify({ event: 'text_reply', text: greeting }))
    }
  }

  private async processSpeechTurn(
    client: WebSocket,
    session: ClientSession
  ): Promise<void> {
    try {
      const transcript = await this.sttService.transcribe(session.logId)
      if (!transcript.trim()) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ event: 'thinking_failed' }))
        }
        return
      }

      session.messages.push({ role: 'user', content: transcript })
      this.logger.log(
        `[Session ${session.logId}] 👤 User (Voice): "${transcript}"`
      )
      await this.consultationService.addMessage(
        session.logId,
        'user',
        transcript
      )

      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            event: 'text_reply',
            text: `Khách hàng: ${transcript}`,
          })
        )
      }

      await this.generateAndSendReply(client, session)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const errStack = err instanceof Error ? err.stack : ''
      this.logger.error(
        `[Session ${session.logId}] ❌ Error in processSpeechTurn: ${errMsg}\n${errStack}`
      )
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event: 'thinking_failed' }))
      }
    }
  }

  private async generateAndSendReply(
    client: WebSocket,
    session: ClientSession
  ): Promise<void> {
    try {
      const messages = session.messages

      const isTransfer = this.consultationService.checkTransferRules(messages)
      if (isTransfer) {
        await this.handleTransfer(client, session)
        return
      }

      const history = this.getChatHistory(messages)
      let reply = await this.groqLlmService.chat(history)

      // Check if reply indicates session end
      let isEnd = false
      const lowerReply = reply.toLowerCase()
      if (
        lowerReply.includes('[kết_thúc]') ||
        lowerReply.includes('tạm biệt') ||
        lowerReply.includes('chuyển bạn đến trang') ||
        lowerReply.includes('xin lỗi đã làm phiền')
      ) {
        isEnd = true
        reply = reply.replace(/\[kết_thúc\]/gi, '').trim()
      }

      session.messages.push({ role: 'assistant', content: reply })
      this.logger.log(`[Session ${session.logId}] 🤖 AI Reply: "${reply}"`)
      await this.consultationService.addMessage(
        session.logId,
        'assistant',
        reply
      )

      const audio = await this.ttsService.textToSpeech(reply)

      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            event: 'chunk',
            media: { payload: audio, format: 'mp3' },
          })
        )
        client.send(JSON.stringify({ event: 'text_reply', text: reply }))

        if (isEnd) {
          client.send(JSON.stringify({ event: 'session_completed' }))
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const errStack = err instanceof Error ? err.stack : ''
      this.logger.error(
        `[Session ${session.logId}] ❌ Error in generateAndSendReply: ${errMsg}\n${errStack}`
      )
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ event: 'thinking_failed' }))
      }
    }
  }

  private async handleTransfer(
    client: WebSocket,
    session: ClientSession
  ): Promise<void> {
    const transferMsg =
      'Dạ vâng, tôi xin phép chuyển cuộc gọi này đến nhân viên hỗ trợ trực tiếp. Xin quý khách vui lòng đợi trong giây lát.'

    session.messages.push({ role: 'assistant', content: transferMsg })
    this.logger.log(
      `[Session ${session.logId}] 🔀 Transfer initiated: "${transferMsg}"`
    )
    await this.consultationService.addMessage(
      session.logId,
      'assistant',
      transferMsg
    )

    await this.logRepository.update(
      { logId: session.logId },
      { status: 'transferred' }
    )

    const audio = await this.ttsService.textToSpeech(transferMsg)
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          event: 'chunk',
          media: { payload: audio, format: 'mp3' },
        })
      )
      client.send(JSON.stringify({ event: 'text_reply', text: transferMsg }))
      client.send(JSON.stringify({ event: 'session_completed' }))
    }
  }

  private getChatHistory(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    const systemPrompt = `Bạn là trợ lý ảo AI tư vấn thuê căn hộ của công ty TH PropTech.

QUY TẮC QUAN TRỌNG VÀ KỊCH BẢN TƯ VẤN:
- Mở đầu cuộc trò chuyện, bạn đã hỏi: "Xin chào! Tôi là Trợ lý ảo tư vấn căn hộ TH PropTech. Bạn có thể dành một chút thời gian để nghe tư vấn thuê căn hộ được không ạ?"
- Nếu khách trả lời KHÔNG ("Đang bận", "Cúp máy", "Không rảnh", "Không", "Bận") -> Trả lời lịch sự: "Dạ vâng, xin lỗi đã làm phiền bạn. Tạm biệt." và thêm "[KẾT_THÚC]" vào cuối câu.
- Nếu khách trả lời CÓ ("Được", "Nói đi", "Có", "Ok", "Đồng ý") -> Lập tức giới thiệu các dòng căn hộ cho thuê: "Cảm ơn bạn. Hiện bên mình đang có các dòng căn hộ cho thuê chính gồm: Căn Studio (13.000.000đ/tháng), Căn hộ 2 phòng ngủ (18.000.000đ - 20.000.000đ/tháng) và Căn hộ 3 phòng ngủ/Penthouse (28.000.000đ - 45.000.000đ/tháng). Bạn muốn tìm hiểu chi tiết căn hộ mấy phòng ngủ hoặc ở dự án nào ạ?"
- Nếu khách ĐỒNG Ý THUÊ, ĐỒNG Ý ĐĂNG KÝ hoặc CHỌN MỘT CĂN HỘ CỤ THỂ -> Tuyệt đối không hỏi lại số điện thoại/email (vì hệ thống đã tự động có sẵn). Chỉ trả lời: "Cảm ơn bạn đã tham gia tư vấn. Hệ thống đã ghi nhận nhu cầu thuê căn hộ của bạn, và giờ đây sẽ chuyển bạn đến trang chi tiết căn hộ để tiến hành đặt lịch xem nhà." và thêm "[KẾT_THÚC]" vào cuối câu.
- Trả lời NGẮN GỌN, tự nhiên như nói chuyện điện thoại (chỉ từ 1 đến 2 câu ngắn).
- Tuyệt đối không dùng markdown, bullet points, hoặc emoji.`

    return [{ role: 'system' as const, content: systemPrompt }, ...messages]
  }
}
