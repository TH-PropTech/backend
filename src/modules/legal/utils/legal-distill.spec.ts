import type { GroqKeyPool } from '../../ai/services/groq-key-pool.service'
import {
  DISTILL_MAX_WINDOWS,
  DISTILL_WINDOW_CHARS,
  distillLegalPage,
  parseSuggestion,
  splitWindows,
} from './legal-distill'

function groqReply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fakePool(hasKeys = true): GroqKeyPool {
  return {
    hasKeys: () => hasKeys,
    run: jest.fn(
      async (_model: string, request: (key: string) => Promise<Response>) =>
        request('gsk_test_key')
    ),
  } as unknown as GroqKeyPool
}

const paragraph = (index: number, size: number): string =>
  `Điều ${index}. ${'a'.repeat(size - `Điều ${index}. `.length)}`

describe('splitWindows', () => {
  it('returns no windows for blank text', () => {
    expect(splitWindows('  \n\n  ', 100)).toEqual([])
  })

  it('groups paragraphs up to the window size on blank-line boundaries', () => {
    const windows = splitWindows(['aaaa', 'bbbb', 'cccc'].join('\n\n'), 10)

    expect(windows).toEqual(['aaaa\n\nbbbb', 'cccc'])
  })

  it('hard-splits a paragraph longer than the window size', () => {
    const windows = splitWindows('x'.repeat(25), 10)

    expect(windows.map(window => window.length)).toEqual([10, 10, 5])
  })

  it('never produces a window longer than the size', () => {
    const text = Array.from({ length: 30 }, (_, i) => paragraph(i, 900)).join(
      '\n\n'
    )
    const windows = splitWindows(text, DISTILL_WINDOW_CHARS)

    expect(windows.every(window => window.length <= DISTILL_WINDOW_CHARS)).toBe(
      true
    )
  })
})

describe('parseSuggestion', () => {
  it('reads JSON wrapped in prose and clamps and filters fields', () => {
    const json = JSON.stringify({
      title: '  Luật Nhà ở  ',
      docNumber: '27/2023/QH15',
      issuer: 'Quốc hội',
      category: 'luat',
      keywords: ['đặt cọc', ' đặt cọc ', 'thuê nhà', '', ' ', 'x'.repeat(80)],
      summary: 'Tóm tắt.',
    })
    const raw = `Kết quả: ${json} hết`

    const suggestion = parseSuggestion(raw)

    expect(suggestion).toEqual({
      title: 'Luật Nhà ở',
      docNumber: '27/2023/QH15',
      issuer: 'Quốc hội',
      category: 'luat',
      summary: 'Tóm tắt.',
      keywords: ['đặt cọc', 'thuê nhà', 'x'.repeat(60)],
    })
  })

  it('drops an invalid category and falls back to the page title', () => {
    const suggestion = parseSuggestion('{"category":"bất kỳ"}', 'Trang gốc')

    expect(suggestion).toEqual({ title: 'Trang gốc', keywords: [] })
  })

  it('returns an empty suggestion for invalid JSON', () => {
    expect(parseSuggestion('không phải json {', undefined)).toEqual({
      keywords: [],
    })
  })
})

describe('distillLegalPage', () => {
  let fetchSpy: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('distils each window and parses the metadata reply', async () => {
    const text = [paragraph(1, 9000), paragraph(2, 9000)].join('\n\n')
    // Replies must keep a realistic share of the page, or the over-filter guard kicks in.
    const part1 = `# Điều 1\n${'Nội dung 1. '.repeat(300)}`
    const part2 = `# Điều 2\n${'Nội dung 2. '.repeat(300)}`
    fetchSpy
      .mockResolvedValueOnce(groqReply(part1))
      .mockResolvedValueOnce(groqReply(part2))
      .mockResolvedValueOnce(
        groqReply(
          '{"title":"Luật Nhà ở","category":"luat","keywords":["thuê nhà"]}'
        )
      )

    const result = await distillLegalPage(
      { pageTitle: 'Trang', url: 'https://example.gov.vn/a', text },
      fakePool()
    )

    expect(result.distilled).toBe(true)
    expect(result.content).toBe(`${part1.trim()}\n\n${part2.trim()}`)
    expect(result.suggestion).toEqual({
      title: 'Luật Nhà ở',
      category: 'luat',
      keywords: ['thuê nhà'],
    })
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    const init = fetchSpy.mock.calls[0]?.[1]
    const firstBody = JSON.parse(
      typeof init?.body === 'string' ? init.body : '{}'
    ) as {
      model: string
      temperature: number
    }
    expect(firstBody.model).toBe('openai/gpt-oss-20b')
    expect(firstBody.temperature).toBe(0)
  })

  it('caps the input at the window limit and notes the truncation', async () => {
    const text = Array.from({ length: DISTILL_MAX_WINDOWS + 2 }, (_, i) =>
      paragraph(i, 9000)
    ).join('\n\n')
    fetchSpy.mockImplementation(() =>
      Promise.resolve(groqReply('Nội dung chắt lọc. '.repeat(400)))
    )

    const result = await distillLegalPage(
      { url: 'https://example.gov.vn/long', text },
      fakePool()
    )

    expect(result.distilled).toBe(true)
    expect(result.content).toContain('chỉ phần đầu được chắt lọc')
    // One call per window (max 6) plus one metadata call.
    expect(fetchSpy).toHaveBeenCalledTimes(DISTILL_MAX_WINDOWS + 1)
  })

  it('falls back to cleaned raw text when the AI call fails', async () => {
    fetchSpy.mockResolvedValue(new Response('boom', { status: 500 }))

    const result = await distillLegalPage(
      {
        pageTitle: 'Trang gốc',
        url: 'https://example.gov.vn/a',
        text: paragraph(1, 300),
      },
      fakePool()
    )

    expect(result).toEqual({
      content: paragraph(1, 300),
      distilled: false,
      suggestion: { keywords: [], title: 'Trang gốc' },
    })
  })

  it('falls back to the raw text when the AI keeps almost nothing of a long page', async () => {
    fetchSpy.mockResolvedValue(groqReply('**Thông tin pháp lý**'))
    const text = paragraph(1, 3000)

    const result = await distillLegalPage(
      { url: 'https://example.gov.vn/a', text },
      fakePool()
    )

    expect(result.distilled).toBe(false)
    expect(result.content).toBe(text)
  })

  it('falls back when the AI reply is empty', async () => {
    fetchSpy.mockResolvedValue(groqReply('   '))

    const result = await distillLegalPage(
      { url: 'https://example.gov.vn/a', text: paragraph(1, 300) },
      fakePool()
    )

    expect(result.distilled).toBe(false)
    expect(result.suggestion).toEqual({ keywords: [] })
  })

  it('falls back without calling the AI when no Groq key is configured', async () => {
    const result = await distillLegalPage(
      { url: 'https://example.gov.vn/a', text: paragraph(1, 300) },
      fakePool(false)
    )

    expect(result.distilled).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the distilled text when only the metadata reply is not valid JSON', async () => {
    fetchSpy
      .mockResolvedValueOnce(groqReply('# Điều 1\nNội dung'))
      .mockResolvedValueOnce(groqReply('không phải JSON'))

    const result = await distillLegalPage(
      {
        pageTitle: 'Trang',
        url: 'https://example.gov.vn/a',
        text: paragraph(1, 300),
      },
      fakePool()
    )

    expect(result.distilled).toBe(true)
    expect(result.content).toBe('# Điều 1\nNội dung')
    expect(result.suggestion).toEqual({ title: 'Trang', keywords: [] })
  })
})
