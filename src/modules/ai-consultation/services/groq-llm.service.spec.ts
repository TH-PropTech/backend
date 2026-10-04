import { GroqLlmService } from './groq-llm.service'

describe('GroqLlmService', () => {
  const originalKey = process.env.GROQ_API_KEY
  const originalFetch = global.fetch

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = originalKey
    global.fetch = originalFetch
  })

  it('returns a configuration message without making a network request', async () => {
    delete process.env.GROQ_API_KEY
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    global.fetch = fetchMock

    await expect(new GroqLlmService().chat([])).resolves.toContain('Groq')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the selected key and conversation to Groq', async () => {
    process.env.GROQ_API_KEY = 'server-key'
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Tư vấn phù hợp' } }],
        })
      )
    )
    global.fetch = fetchMock

    await expect(
      new GroqLlmService().chat(
        [{ role: 'user', content: 'Tôi cần căn hộ 2 phòng ngủ' }],
        'session-key'
      )
    ).resolves.toBe('Tư vấn phù hợp')

    const options = fetchMock.mock.calls[0]?.[1]
    expect(options?.headers).toMatchObject({
      Authorization: 'Bearer session-key',
    })
    const requestBody = options?.body
    if (typeof requestBody !== 'string') {
      throw new Error('Expected a JSON Groq request body')
    }
    expect(JSON.parse(requestBody)).toMatchObject({
      model: 'openai/gpt-oss-120b',
      reasoning_effort: 'low',
    })
  })

  it('returns a recoverable assistant message on provider failure', async () => {
    process.env.GROQ_API_KEY = 'server-key'
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    fetchMock.mockResolvedValue(new Response('failure', { status: 500 }))
    global.fetch = fetchMock

    await expect(new GroqLlmService().chat([])).resolves.toContain(
      'lỗi kết nối'
    )
  })
})
