import { ConflictException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { ActivityLogMemoryRepository } from '../../activity-log/utils/activity-log-memory-repository.fixtures'
import type { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import type { User } from '../../users/schemas/user.schema'
import {
  AI_CONSULTATION_MAX_MESSAGES,
  AiConsultationService,
} from './ai-consultation.service'
import type { ConsultationEmailService } from './consultation-email.service'
import type { GroqLlmService } from './groq-llm.service'

type Message = { role: 'user' | 'assistant' | 'system'; content: string }

function createService(): {
  service: AiConsultationService
  activity: ActivityLogMemoryRepository
  userRepository: { findOne: jest.Mock }
  emailService: { sendInvitation: jest.Mock; sendSummary: jest.Mock }
  groqLlmService: { chat: jest.Mock }
} {
  const activity = new ActivityLogMemoryRepository()
  const userRepository = { findOne: jest.fn().mockResolvedValue(null) }
  const emailService = {
    sendInvitation: jest.fn().mockResolvedValue(undefined),
    sendSummary: jest.fn().mockResolvedValue(undefined),
  }
  const groqLlmService = { chat: jest.fn() }
  const service = new AiConsultationService(
    activity as unknown as Repository<ActivityLog>,
    userRepository as unknown as Repository<User>,
    emailService as unknown as ConsultationEmailService,
    groqLlmService as unknown as GroqLlmService
  )

  return { service, activity, userRepository, emailService, groqLlmService }
}

function seedSession(
  activity: ActivityLogMemoryRepository,
  logId: string,
  messages: Message[] = [],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return activity.seed({
    kind: 'ai-consultation',
    logId,
    userId: null,
    messages: messages.map(message => ({ ...message, timestamp: new Date() })),
    status: 'in_progress',
    result: 'not_interested',
    duration: 0,
    ...extra,
  })
}

function messagesOf(
  activity: ActivityLogMemoryRepository,
  logId: string
): Message[] {
  const doc = activity.docs.find(row => row.logId === logId)
  return (doc?.messages ?? []) as Message[]
}

describe('AiConsultationService', () => {
  it('creates a pending session and sends an invitation for a known user', async () => {
    const { service, activity, userRepository, emailService } = createService()
    userRepository.findOne.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      email: 'tenant@example.com',
      fullName: 'Nguyen Van A',
    })

    const result = await service.startSession('507f1f77bcf86cd799439011')

    expect(result.logId).toMatch(/^call_\d+_[a-z0-9]+$/)
    expect(result.status).toBe('email_sent')
    expect(result.result).toBe('not_interested')
    // Lần ghi thứ hai (sau khi gửi mail) là UPDATE theo _id, không tạo document trùng logId.
    expect(activity.docs).toHaveLength(1)
    expect(activity.docs[0]?.status).toBe('email_sent')
    expect(result._id).toBeInstanceOf(ObjectId)
    expect(result._id).toEqual(activity.docs[0]?._id)
    expect(emailService.sendInvitation).toHaveBeenCalledWith(
      'tenant@example.com',
      result.logId,
      'Nguyen Van A'
    )
  })

  it('completes and analyzes a session, then sends a summary for interested users', async () => {
    const { service, activity, userRepository, emailService, groqLlmService } =
      createService()
    seedSession(
      activity,
      'call-1',
      [{ role: 'user', content: 'Tôi muốn thuê căn hộ' }],
      {
        userId: '507f1f77bcf86cd799439011',
      }
    )
    userRepository.findOne.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      email: 'tenant@example.com',
    })
    groqLlmService.chat.mockResolvedValue(
      JSON.stringify({
        result: 'interested',
        recommendedPackage: 'Căn hộ 2PN',
        notes: 'Cần xem nhà cuối tuần',
      })
    )

    await service.completeSession('call-1', 95)

    expect(activity.docs[0]).toMatchObject({
      kind: 'ai-consultation',
      logId: 'call-1',
      status: 'completed',
      duration: 95,
      result: 'interested',
      recommendedPackage: 'Căn hộ 2PN',
      notes: 'Cần xem nhà cuối tuần',
    })
    expect(messagesOf(activity, 'call-1')).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Tôi muốn thuê căn hộ',
      }),
    ])
    expect(emailService.sendSummary).toHaveBeenCalledWith(
      'tenant@example.com',
      95,
      'Căn hộ 2PN',
      'Cần xem nhà cuối tuần'
    )
  })

  it('returns transfer intent only for a user message containing a transfer request', () => {
    const { service } = createService()

    expect(
      service.checkTransferRules([
        { role: 'assistant', content: 'Tôi có thể tư vấn thêm.' },
        { role: 'user', content: 'Tôi muốn gặp nhân viên.' },
      ])
    ).toBe(true)
    expect(service.checkTransferRules([])).toBe(false)
    expect(
      service.checkTransferRules([{ role: 'assistant', content: 'hotline' }])
    ).toBe(false)
  })

  it('does not write when a completion references an unknown session', async () => {
    const { service, activity, emailService } = createService()

    await service.completeSession('missing', 10)

    expect(activity.docs).toHaveLength(0)
    expect(emailService.sendSummary).not.toHaveBeenCalled()
  })

  it('appends a message to the session under its kind', async () => {
    const { service, activity } = createService()
    seedSession(activity, 'call-2')

    await service.addMessage('call-2', 'user', 'Xin chào')

    expect(activity.docs).toHaveLength(1)
    expect(activity.docs[0]?.kind).toBe('ai-consultation')
    expect(messagesOf(activity, 'call-2')).toEqual([
      expect.objectContaining({ role: 'user', content: 'Xin chào' }),
    ])
  })

  it('does nothing when adding a message to an unknown session', async () => {
    const { service, activity } = createService()

    await expect(
      service.addMessage('missing', 'user', 'Xin chào')
    ).resolves.toBeUndefined()
    expect(activity.docs).toHaveLength(0)
  })

  it('does not append to a session of another kind with the same logId', async () => {
    const { service, activity } = createService()
    activity.seed({ kind: 'http', logId: 'call-x', messages: [] })

    await service.addMessage('call-x', 'user', 'Xin chào')

    expect(activity.docs[0]?.messages).toEqual([])
  })

  it('caps the messages of one session via the update filter and refuses the message that would exceed the cap', async () => {
    const { service, activity } = createService()
    const full = Array.from({ length: AI_CONSULTATION_MAX_MESSAGES }, () => ({
      role: 'user' as const,
      content: 'x',
    }))
    seedSession(activity, 'call-3', full)
    const updateSpy = jest.spyOn(activity, 'updateOne')

    await expect(
      service.addMessage('call-3', 'assistant', 'quá trần')
    ).rejects.toThrow(ConflictException)
    await expect(
      service.addMessage('call-3', 'assistant', 'quá trần')
    ).rejects.toThrow('AI_CONSULTATION_MESSAGE_LIMIT_REACHED')

    // Điều kiện trần nằm trong filter của lệnh cập nhật, không kiểm ở app rồi ghi.
    expect(updateSpy).toHaveBeenCalledWith(
      {
        kind: 'ai-consultation',
        logId: 'call-3',
        [`messages.${AI_CONSULTATION_MAX_MESSAGES - 1}`]: { $exists: false },
      },
      expect.anything()
    )
    expect(messagesOf(activity, 'call-3')).toHaveLength(
      AI_CONSULTATION_MAX_MESSAGES
    )
  })

  it('keeps accepting messages just below the cap', async () => {
    const { service, activity } = createService()
    const almostFull = Array.from(
      { length: AI_CONSULTATION_MAX_MESSAGES - 1 },
      () => ({ role: 'user' as const, content: 'x' })
    )
    seedSession(activity, 'call-4', almostFull)

    await service.addMessage('call-4', 'assistant', 'vừa đủ')

    const messages = messagesOf(activity, 'call-4')
    expect(messages).toHaveLength(AI_CONSULTATION_MAX_MESSAGES)
    expect(messages[messages.length - 1]?.content).toBe('vừa đủ')

    await expect(
      service.addMessage('call-4', 'user', 'vượt trần')
    ).rejects.toThrow(ConflictException)
    expect(messagesOf(activity, 'call-4')).toHaveLength(
      AI_CONSULTATION_MAX_MESSAGES
    )
  })

  it('keeps every message when two addMessage calls run concurrently', async () => {
    const { service, activity } = createService()
    seedSession(activity, 'call-5')

    await Promise.all([
      service.addMessage('call-5', 'user', 'tin A'),
      service.addMessage('call-5', 'assistant', 'tin B'),
    ])

    const contents = messagesOf(activity, 'call-5').map(m => m.content)
    expect(contents).toHaveLength(2)
    expect(contents).toEqual(expect.arrayContaining(['tin A', 'tin B']))
  })

  it('keeps all messages under a burst of concurrent addMessage calls', async () => {
    const { service, activity } = createService()
    seedSession(activity, 'call-6')
    const burst = Array.from({ length: 20 }, (_, i) =>
      service.addMessage('call-6', 'user', `tin ${i}`)
    )

    await Promise.all(burst)

    const contents = messagesOf(activity, 'call-6').map(m => m.content)
    expect(new Set(contents).size).toBe(20)
  })

  it('does not drop a message added while completeSession waits for the AI analysis', async () => {
    const { service, activity, groqLlmService } = createService()
    seedSession(activity, 'call-7', [{ role: 'user', content: 'lượt đầu' }])
    let resolveChat: (value: string) => void = () => undefined
    groqLlmService.chat.mockReturnValue(
      new Promise<string>(resolve => {
        resolveChat = resolve
      })
    )

    const completing = service.completeSession('call-7', 60)
    await service.addMessage('call-7', 'assistant', 'tin giữa chừng')
    resolveChat(
      JSON.stringify({ result: 'not_interested', notes: 'Chưa có nhu cầu' })
    )
    await completing

    expect(messagesOf(activity, 'call-7').map(m => m.content)).toEqual([
      'lượt đầu',
      'tin giữa chừng',
    ])
    expect(activity.docs[0]).toMatchObject({
      status: 'completed',
      duration: 60,
      notes: 'Chưa có nhu cầu',
    })
  })
})
