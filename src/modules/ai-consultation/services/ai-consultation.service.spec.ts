import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { AiConsultationLog } from '../schemas/ai-consultation-log.schema'
import type { User } from '../../users/schemas/user.schema'
import { AiConsultationService } from './ai-consultation.service'
import type { ConsultationEmailService } from './consultation-email.service'
import type { GroqLlmService } from './groq-llm.service'

function createService(): {
  service: AiConsultationService
  logRepository: { find: jest.Mock; findOne: jest.Mock; save: jest.Mock }
  userRepository: { findOne: jest.Mock }
  emailService: { sendInvitation: jest.Mock; sendSummary: jest.Mock }
  groqLlmService: { chat: jest.Mock }
} {
  const logRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest
      .fn()
      .mockImplementation((log: AiConsultationLog) => Promise.resolve(log)),
  }
  const userRepository = { findOne: jest.fn().mockResolvedValue(null) }
  const emailService = {
    sendInvitation: jest.fn().mockResolvedValue(undefined),
    sendSummary: jest.fn().mockResolvedValue(undefined),
  }
  const groqLlmService = { chat: jest.fn() }
  const service = new AiConsultationService(
    logRepository as unknown as Repository<AiConsultationLog>,
    userRepository as unknown as Repository<User>,
    emailService as unknown as ConsultationEmailService,
    groqLlmService as unknown as GroqLlmService
  )

  return {
    service,
    logRepository,
    userRepository,
    emailService,
    groqLlmService,
  }
}

describe('AiConsultationService', () => {
  it('creates a pending session and sends an invitation for a known user', async () => {
    const { service, logRepository, userRepository, emailService } =
      createService()
    userRepository.findOne.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      email: 'tenant@example.com',
      fullName: 'Nguyen Van A',
    })

    const result = await service.startSession('507f1f77bcf86cd799439011')

    expect(result.logId).toMatch(/^call_\d+_[a-z0-9]+$/)
    expect(result.status).toBe('email_sent')
    expect(result.result).toBe('not_interested')
    expect(logRepository.save).toHaveBeenCalledTimes(2)
    expect(emailService.sendInvitation).toHaveBeenCalledWith(
      'tenant@example.com',
      result.logId,
      'Nguyen Van A'
    )
  })

  it('completes and analyzes a session, then sends a summary for interested users', async () => {
    const {
      service,
      logRepository,
      userRepository,
      emailService,
      groqLlmService,
    } = createService()
    const log = Object.assign(new AiConsultationLog(), {
      logId: 'call-1',
      userId: '507f1f77bcf86cd799439011',
      messages: [
        {
          role: 'user' as const,
          content: 'Tôi muốn thuê căn hộ',
          timestamp: new Date(),
        },
      ],
      status: 'in_progress' as const,
      result: 'not_interested' as const,
      duration: 0,
    })
    logRepository.findOne.mockResolvedValue(log)
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

    expect(log.status).toBe('completed')
    expect(log.duration).toBe(95)
    expect(log.recommendedPackage).toBe('Căn hộ 2PN')
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
    const { service, logRepository } = createService()

    await service.completeSession('missing', 10)

    expect(logRepository.save).not.toHaveBeenCalled()
  })
})
