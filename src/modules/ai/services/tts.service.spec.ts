import { TtsService } from './tts.service'

describe('TtsService', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns base64 audio and splits long input into provider-safe chunks', async () => {
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(Buffer.from('mp3')))
    )
    global.fetch = fetchMock

    const result = await new TtsService().textToSpeech(`a ${'b '.repeat(120)}`)

    expect(Buffer.from(result, 'base64').toString()).toBe('mp3mp3')
    expect(fetchMock.mock.calls.length).toBe(2)
    const requestUrl = fetchMock.mock.calls[0]?.[0]
    const normalizedUrl =
      typeof requestUrl === 'string'
        ? requestUrl
        : requestUrl instanceof Request
          ? requestUrl.url
          : undefined
    expect(normalizedUrl).toContain('translate_tts')
  })

  it('returns an empty audio payload when the provider fails', async () => {
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    fetchMock.mockResolvedValue(
      new Response('unavailable', { status: 503, statusText: 'Unavailable' })
    )
    global.fetch = fetchMock

    await expect(new TtsService().textToSpeech('xin chao')).resolves.toBe('')
  })
})
