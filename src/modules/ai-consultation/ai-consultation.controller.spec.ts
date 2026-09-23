import { AiConsultationController } from './ai-consultation.controller'
import type { AiConsultationLog } from './schemas/ai-consultation-log.schema'
import type { AiConsultationService } from './services/ai-consultation.service'

describe('AiConsultationController', () => {
  it('delegates session creation and log listing to the service', async () => {
    const log = { logId: 'call-1' } as AiConsultationLog
    const service = {
      startSession: jest.fn().mockResolvedValue(log),
      getLogs: jest.fn().mockResolvedValue([log]),
    }
    const controller = new AiConsultationController(
      service as unknown as AiConsultationService
    )

    await expect(controller.start({ userId: 'user-1' })).resolves.toBe(log)
    await expect(controller.getLogs()).resolves.toEqual([log])
    expect(service.startSession).toHaveBeenCalledWith('user-1')
  })

  it('completes web sessions and returns an explicit success response', async () => {
    const service = {
      completeSession: jest.fn().mockResolvedValue(undefined),
    }
    const controller = new AiConsultationController(
      service as unknown as AiConsultationService
    )

    await expect(
      controller.webComplete({ logId: 'call-1', duration: 42 })
    ).resolves.toEqual({ success: true })
    expect(service.completeSession).toHaveBeenCalledWith('call-1', 42)
  })
})
