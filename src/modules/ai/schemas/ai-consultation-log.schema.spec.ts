import { AiConsultationLog } from './ai-consultation-log.schema'

describe('AiConsultationLog', () => {
  it('models the consultation lifecycle fields with safe defaults', () => {
    const log = new AiConsultationLog()
    log.logId = 'call-1'
    log.messages = []
    log.status = 'pending'
    log.result = 'not_interested'
    log.duration = 0

    expect(log).toMatchObject({
      logId: 'call-1',
      messages: [],
      status: 'pending',
      result: 'not_interested',
      duration: 0,
    })
  })
})
