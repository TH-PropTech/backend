import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroqKeyPool } from './groq-key-pool.service'
import {
  GROQ_CONNECTION_ERROR_REPLY,
  GroqAgentService,
  type ChatMessage,
  GroqRequestError,
  isRetryableGroqError,
} from './groq-agent.service'

const ok = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
  })
const fail = (status: number, body: string): Response =>
  new Response(body, { status })

function build(responses: Array<Response | Error>): {
  service: GroqAgentService
  fetchMock: ReturnType<typeof vi.fn>
} {
  const queue = [...responses]
  const fetchMock = vi.fn(() => {
    const next = queue.shift() ?? ok('hết kịch bản')
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  })
  vi.stubGlobal('fetch', fetchMock)
  const pool = {
    hasKeys: () => true,
    run: (_model: string, call: (key: string) => Promise<Response>) =>
      call('key'),
  } as unknown as GroqKeyPool
  return { service: new GroqAgentService(pool), fetchMock }
}

const sentBody = (
  fetchMock: ReturnType<typeof vi.fn>,
  call: number
): { tools?: unknown } => {
  const init = fetchMock.mock.calls[call]?.[1] as { body: string }
  return JSON.parse(init.body) as { tools?: unknown }
}

describe('GroqAgentService retries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const ask = async (
    service: GroqAgentService,
    disableTools = false
  ): Promise<{ content: string | null }> => {
    const pending = service.chat(
      [{ role: 'user', content: 'Xin chào' }],
      disableTools
    )
    await vi.runAllTimersAsync()
    return pending
  }

  it('answers normally without retrying when the first call works', async () => {
    const { service, fetchMock } = build([ok('Chào bạn')])
    expect((await ask(service)).content).toBe('Chào bạn')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a malformed tool call (HTTP 400 tool_use_failed) instead of apologising', async () => {
    const { service, fetchMock } = build([
      fail(
        400,
        '{"error":{"code":"tool_use_failed","failed_generation":"..."}}'
      ),
      ok('Trả lời sau khi thử lại'),
    ])
    expect((await ask(service)).content).toBe('Trả lời sau khi thử lại')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a transient server error and a network failure', async () => {
    const { service, fetchMock } = build([
      fail(503, 'unavailable'),
      new Error('fetch failed'),
      ok('Đã được'),
    ])
    expect((await ask(service)).content).toBe('Đã được')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('drops the tools on the last attempt so the question still gets a plain answer', async () => {
    const { service, fetchMock } = build([
      fail(400, 'tool_use_failed'),
      fail(400, 'tool_use_failed'),
      ok('Trả lời không dùng công cụ'),
    ])
    expect((await ask(service)).content).toBe('Trả lời không dùng công cụ')
    expect(sentBody(fetchMock, 0).tools).toBeDefined()
    expect(sentBody(fetchMock, 1).tools).toBeDefined()
    expect(sentBody(fetchMock, 2).tools).toBeUndefined()
  })

  it('gives up with the connection message after the attempts are used up', async () => {
    const { service, fetchMock } = build([
      fail(500, 'x'),
      fail(500, 'x'),
      fail(500, 'x'),
    ])
    expect((await ask(service)).content).toBe(GROQ_CONNECTION_ERROR_REPLY)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a rejected key or a bad request', async () => {
    const unauthorized = build([fail(401, 'invalid key')])
    expect((await ask(unauthorized.service)).content).toBe(
      GROQ_CONNECTION_ERROR_REPLY
    )
    expect(unauthorized.fetchMock).toHaveBeenCalledTimes(1)

    const badRequest = build([fail(400, 'invalid request body')])
    await ask(badRequest.service)
    expect(badRequest.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses only two attempts when tools are already disabled', async () => {
    const { service, fetchMock } = build([fail(500, 'x'), fail(500, 'x')])
    expect((await ask(service, true)).content).toBe(GROQ_CONNECTION_ERROR_REPLY)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('GroqAgentService legal answer request', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  interface SentMessage {
    role: string
    content: string
  }
  const sentMessages = (fetchMock: ReturnType<typeof vi.fn>): SentMessage[] => {
    const init = fetchMock.mock.calls[0]?.[1] as { body: string }
    return (JSON.parse(init.body) as { messages: SentMessage[] }).messages
  }

  // ~4,400 characters: the size the retrieval step now hands over (4 passages + headings)
  const passages = `[1] Văn bản: Luật Nhà ở 2023
Nội dung: ${'Bên cho thuê nhà ở có quyền đơn phương chấm dứt hợp đồng khi bên thuê không trả đủ tiền thuê nhà. '.repeat(40)}`

  const legalConversation: ChatMessage[] = [
    {
      role: 'user',
      content: 'Chủ nhà được đơn phương chấm dứt hợp đồng khi nào?',
    },
    {
      role: 'tool',
      name: 'search_legal_knowledge',
      tool_call_id: 'c1',
      content: passages,
    },
  ]

  it('sends the compact legal prompt without tool definitions', async () => {
    const { service, fetchMock } = build([ok('Trả lời')])
    await service.chat(legalConversation, false, { legalAnswer: true })

    const init = fetchMock.mock.calls[0]?.[1] as { body: string }
    expect((JSON.parse(init.body) as { tools?: unknown }).tools).toBeUndefined()
    const system = sentMessages(fetchMock)[0]
    expect(system?.role).toBe('system')
    expect(system?.content).toContain('TRI THỨC PHÁP LÝ')
    expect(system?.content).not.toContain('BƯỚC TÌM KIẾM')
    expect(system?.content).not.toContain('request_booking')
  })

  it('keeps the retrieved passages whole instead of squeezing them to a few hundred characters', async () => {
    const { service, fetchMock } = build([ok('Trả lời')])
    await service.chat(legalConversation, false, { legalAnswer: true })

    const tool = sentMessages(fetchMock).find(m => m.role === 'tool')
    expect(tool?.content).toBe(passages)
    expect(tool?.content).not.toContain('đã rút gọn')
  })

  it('shows what the old full prompt did: the same passages were cut down to the minimum', async () => {
    const { service, fetchMock } = build([ok('Trả lời')])
    await service.chat(legalConversation, false)

    const tool = sentMessages(fetchMock).find(m => m.role === 'tool')
    expect(tool?.content.length).toBeLessThan(passages.length / 2)
    expect(tool?.content).toContain('đã rút gọn')
  })
})

describe('isRetryableGroqError', () => {
  it('classifies Groq responses', () => {
    expect(isRetryableGroqError(new GroqRequestError(429, 'rate'))).toBe(true)
    expect(isRetryableGroqError(new GroqRequestError(502, 'bad gateway'))).toBe(
      true
    )
    expect(
      isRetryableGroqError(
        new GroqRequestError(400, 'Failed to call a function')
      )
    ).toBe(true)
    expect(isRetryableGroqError(new GroqRequestError(401, 'no'))).toBe(false)
    expect(isRetryableGroqError(new GroqRequestError(400, 'bad json'))).toBe(
      false
    )
    expect(isRetryableGroqError(new TypeError('fetch failed'))).toBe(true)
  })
})
