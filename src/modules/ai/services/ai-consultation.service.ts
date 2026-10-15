import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { User } from '../../users/schemas/user.schema'
import { AiConsultationLog } from '../schemas/ai-consultation-log.schema'
import { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import { KindScopedActivityLogRepository } from '../../activity-log/utils/kind-scoped-activity-log.repository'
import { toAiConsultationLog } from '../../activity-log/utils/legacy-log.mapper'
import { ConsultationEmailService } from './consultation-email.service'
import { GroqLlmService } from './groq-llm.service'

/** Trần số tin nhắn của một phiên tư vấn (D3: `messages[]` có trần); vượt trần thì 409. */
export const AI_CONSULTATION_MAX_MESSAGES = 500

/** Chỉ giữ trường có giá trị (undefined bỏ qua, null vẫn giữ) để `$set` không ghi đè ngoài ý muốn. */
function definedFields(
  fields: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  )
}

@Injectable()
export class AiConsultationService {
  private readonly logger = new Logger(AiConsultationService.name)
  private readonly logRepository: KindScopedActivityLogRepository<AiConsultationLog>

  constructor(
    @InjectRepository(ActivityLog)
    activityLogRepository: Repository<ActivityLog>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly emailService: ConsultationEmailService,
    private readonly groqLlmService: GroqLlmService
  ) {
    this.logRepository = new KindScopedActivityLogRepository(
      activityLogRepository,
      'ai-consultation',
      toAiConsultationLog
    )
  }

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
  /**
   * Thêm tin nhắn bằng `$push` nguyên tử. Trần được kiểm TRONG filter: chỉ khớp khi
   * phần tử thứ `MAX - 1` chưa tồn tại (tức mảng còn chỗ). Không khớp thì phân biệt
   * phiên không tồn tại (bỏ qua) với phiên đã đủ trần (409).
   */
  async addMessage(
    logId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): Promise<void> {
    const matched = await this.logRepository.updateAtomic(
      {
        logId,
        [`messages.${AI_CONSULTATION_MAX_MESSAGES - 1}`]: { $exists: false },
      },
      {
        $push: {
          messages: { role, content, timestamp: new Date() },
        },
      }
    )
    if (matched > 0) return

    const log = await this.logRepository.findOne({ where: { logId } })
    if (!log) return
    throw new ConflictException('AI_CONSULTATION_MESSAGE_LIMIT_REACHED')
  }

  /**
   * Kết thúc phiên: chỉ `$set` các trường tóm tắt/trạng thái, KHÔNG ghi lại `messages`
   * (tin nhắn có thể được thêm trong lúc chờ Groq phân tích).
   */
  async completeSession(logId: string, durationSeconds: number): Promise<void> {
    const log = await this.logRepository.findOne({ where: { logId } })
    if (!log) return

    log.duration = durationSeconds
    log.status = 'completed'

    if (log.messages.length > 0) {
      await this.analyzeSessionWithAi(log)
    }

    await this.logRepository.updateAtomic(
      { logId },
      {
        $set: definedFields({
          duration: log.duration,
          status: log.status,
          result: log.result,
          recommendedPackage: log.recommendedPackage,
          notes: log.notes,
        }),
      }
    )
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
