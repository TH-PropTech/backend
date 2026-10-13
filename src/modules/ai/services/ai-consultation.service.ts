import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { User } from '../../users/schemas/user.schema'
import { AiConsultationLog } from '../schemas/ai-consultation-log.schema'
import { ConsultationEmailService } from './consultation-email.service'
import { GroqLlmService } from './groq-llm.service'

@Injectable()
export class AiConsultationService {
  private readonly logger = new Logger(AiConsultationService.name)

  constructor(
    @InjectRepository(AiConsultationLog)
    private readonly logRepository: Repository<AiConsultationLog>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly emailService: ConsultationEmailService,
    private readonly groqLlmService: GroqLlmService
  ) {}

  async startSession(userId?: string): Promise<AiConsultationLog> {
    const logId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    const log = new AiConsultationLog()
    log.logId = logId
    log.userId = userId ?? null
    log.messages = []
    log.status = 'pending'
    log.result = 'not_interested'
    log.duration = 0

    await this.logRepository.save(log)
    this.logger.log(`Initialized consultation session: ${logId}`)

    if (userId) {
      await this.sendInviteEmail(log, userId)
    }

    return log
  }
  async addMessage(
    logId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): Promise<void> {
    const log = await this.logRepository.findOne({ where: { logId } })
    if (!log) return

    log.messages = [
      ...log.messages,
      {
        role,
        content,
        timestamp: new Date(),
      },
    ]
    await this.logRepository.save(log)
  }

  async completeSession(logId: string, durationSeconds: number): Promise<void> {
    const log = await this.logRepository.findOne({ where: { logId } })
    if (!log) return

    log.duration = durationSeconds
    log.status = 'completed'

    if (log.messages.length > 0) {
      await this.analyzeSessionWithAi(log)
    }

    await this.logRepository.save(log)
    this.logger.log(`Completed consultation session: ${logId}`)

    if (log.userId && log.result === 'interested') {
      await this.sendSummaryEmail(log)
    }
  }

  checkTransferRules(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): boolean {
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'user') return false

    const content = lastMessage.content.toLowerCase()
    const transferKeywords = [
      'gặp người',
      'nhân viên',
      'chuyển máy',
      'hotline',
      'gặp admin',
      'gặp tư vấn viên',
      'nói chuyện với người',
      'hỗ trợ kỹ thuật',
    ]

    return transferKeywords.some(keyword => content.includes(keyword))
  }

  async getLogs(): Promise<AiConsultationLog[]> {
    return this.logRepository.find({
      order: { createdAt: 'DESC' },
    })
  }

  private async sendInviteEmail(
    log: AiConsultationLog,
    userId: string
  ): Promise<void> {
    try {
      const user = await this.userRepository.findOne({
        where: { _id: new ObjectId(userId) },
      })
      if (user?.email) {
        await this.emailService.sendInvitation(
          user.email,
          log.logId,
          user.fullName
        )
        log.status = 'email_sent'
        await this.logRepository.save(log)
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Failed to send invite email: ${errMsg}`)
    }
  }

  private async sendSummaryEmail(log: AiConsultationLog): Promise<void> {
    try {
      if (!log.userId) return
      const user = await this.userRepository.findOne({
        where: { _id: new ObjectId(log.userId) },
      })
      if (user?.email) {
        await this.emailService.sendSummary(
          user.email,
          log.duration,
          log.recommendedPackage || 'Căn hộ phù hợp',
          log.notes || 'Khách hàng có nhu cầu tư vấn căn hộ.'
        )
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Failed to send summary email: ${errMsg}`)
    }
  }

  private async analyzeSessionWithAi(log: AiConsultationLog): Promise<void> {
    try {
      const conversationText = log.messages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n')

      const prompt = `Dưới đây là hội thoại tư vấn thuê căn hộ giữa khách hàng (user) và trợ lý ảo (assistant):
${conversationText}

Hãy phân tích hội thoại và trả về một đối tượng JSON có định dạng chính xác sau (không chứa markdown, không giải thích):
{
  "result": "interested" or "not_interested",
  "recommendedPackage": "Tên căn hộ đề xuất (ví dụ: Căn hộ 2PN Quận 7) hoặc null",
  "notes": "Tóm tắt ngắn gọn nhu cầu của khách hàng"
}`

      const responseText = await this.groqLlmService.chat([
        { role: 'user', content: prompt },
      ])

      const cleanJson = responseText.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(cleanJson) as {
        result: 'interested' | 'not_interested'
        recommendedPackage?: string | null
        notes?: string | null
      }

      log.result = parsed.result || 'not_interested'
      log.recommendedPackage = parsed.recommendedPackage ?? null
      log.notes = parsed.notes ?? null
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Failed to analyze session with Groq: ${errMsg}`)
      log.result = 'not_interested'
    }
  }
}
