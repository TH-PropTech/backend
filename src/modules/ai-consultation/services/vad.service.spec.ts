import { VadService } from './vad.service'

describe('VadService', () => {
  afterEach(() => jest.restoreAllMocks())

  it('requires speech above the RMS threshold before silence can end a turn', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(0)
    const service = new VadService()

    service.processChunk('call-1', Buffer.from([0xf4, 0x01]))
    now.mockReturnValue(2_000)
    expect(service.isSilent('call-1')).toBe(false)

    now.mockReturnValue(2_001)
    service.processChunk('call-1', Buffer.from([0xd0, 0x07]))
    expect(service.isSilent('call-1')).toBe(false)
    now.mockReturnValue(3_400)
    expect(service.isSilent('call-1')).toBe(false)
    now.mockReturnValue(3_502)
    expect(service.isSilent('call-1')).toBe(true)
  })

  it('clears session state when a call ends', () => {
    const service = new VadService()
    service.processChunk('call-1', Buffer.from([0xd0, 0x07]))
    service.clear('call-1')

    expect(service.isSilent('call-1')).toBe(false)
  })
})
