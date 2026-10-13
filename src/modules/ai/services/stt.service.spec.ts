import { SttService } from './stt.service'

describe('SttService', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns an empty transcript without calling Google for an empty buffer', async () => {
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    global.fetch = fetchMock

    await expect(new SttService().transcribe('empty')).resolves.toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('combines PCM chunks into a WAV request and parses the transcript', async () => {
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    fetchMock.mockResolvedValue(
      new Response(
        '{"result":[{"alternative":[{"transcript":"tim can ho"}]}]}\n'
      )
    )
    global.fetch = fetchMock
    const service = new SttService()

    service.appendAudio('call-1', Buffer.from([1, 0]))
    service.appendAudio('call-1', Buffer.from([2, 0]))

    await expect(service.transcribe('call-1')).resolves.toBe('tim can ho')
    const request = fetchMock.mock.calls[0]
    const body = request?.[1]?.body
    expect(body).toBeInstanceOf(Uint8Array)
    expect(
      Buffer.from(body as Uint8Array)
        .subarray(0, 4)
        .toString()
    ).toBe('RIFF')
  })

  it('clears buffered audio after a failed provider response', async () => {
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    fetchMock.mockResolvedValue(
      new Response('provider failure', { status: 503 })
    )
    global.fetch = fetchMock
    const service = new SttService()
    service.appendAudio('call-1', Buffer.from([1, 0]))

    await expect(service.transcribe('call-1')).resolves.toBe('')
    await expect(service.transcribe('call-1')).resolves.toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
