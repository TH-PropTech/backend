import type { ConfigService } from '@nestjs/config'
import { GroqKeyPool } from '../../groq/groq-key-pool.service'
import { GroqLlmService } from './groq-llm.service'

function createService(...keys: string[]): GroqLlmService {
  const config = { get: jest.fn().mockReturnValue(keys) }
  return new GroqLlmService(new GroqKeyPool(config as unknown as ConfigService))
}

describe('GroqLlmService', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns a configuration message without making a network request', async () => {
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    global.fetch = fetchMock

    await expect(createService().chat([])).resolves.toContain('Groq')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the selected key and conversation to Groq', async () => {
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
      createService('server-key').chat(
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

  it('rotates to the next server key when the first is rate limited', async () => {
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    fetchMock
      .mockResolvedValueOnce(new Response('limit', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' } }] })
        )
      )
    global.fetch = fetchMock

    await expect(createService('key-1', 'key-2').chat([])).resolves.toBe('ok')
    const used = fetchMock.mock.calls.map(
      call => (call[1]?.headers as Record<string, string>).Authorization
    )
    expect(used).toEqual(['Bearer key-1', 'Bearer key-2'])
  })

  it('returns a recoverable assistant message on provider failure', async () => {
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    fetchMock.mockResolvedValue(new Response('failure', { status: 500 }))
    global.fetch = fetchMock

    await expect(createService('server-key').chat([])).resolves.toContain(
      'lỗi kết nối'
    )
  })
})
