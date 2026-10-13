import { Logger } from '@nestjs/common'
import type { GroqKeyPool } from '../../ai/services/groq-key-pool.service'
import type { LegalSuggestion } from '../dto/legal-knowledge-response'
import {
  LEGAL_DOC_CATEGORIES,
  type LegalDocCategory,
} from './legal-knowledge.types'

export const DISTILL_MODEL = 'openai/gpt-oss-20b'
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'
export const DISTILL_WINDOW_CHARS = 10_000
export const DISTILL_MAX_WINDOWS = 6
const DISTILL_MAX_TOKENS = 8000
const METADATA_MAX_TOKENS = 800
const SUMMARY_MAX = 600
const TITLE_MAX = 300
const DOC_NUMBER_MAX = 100
const ISSUER_MAX = 200
const KEYWORD_MAX = 60
const KEYWORDS_MAX = 12
/** If the AI keeps less than this share of a long page, it over-filtered: keep the raw text instead. */
const MIN_KEPT_RATIO = 0.2
const MIN_RAW_CHARS_FOR_RATIO = 1000

const logger = new Logger('LegalDistill')

const DISTILL_SYSTEM_PROMPT =
  'Bạn là biên tập viên pháp lý. Nhiệm vụ: làm sạch văn bản thô lấy từ trang web để làm tài liệu tra cứu, KHÔNG tóm tắt. Giữ lại NGUYÊN VĂN toàn bộ nội dung có giá trị tra cứu: định nghĩa, khái niệm, phân loại, quy định, điều kiện, quyền và nghĩa vụ, thủ tục, hồ sơ, thời hạn, lệ phí, căn cứ pháp lý, ví dụ minh họa. Chỉ loại bỏ: menu, điều hướng, quảng cáo, chú thích kỹ thuật, danh sách liên kết/tham khảo ngoài, nội dung lặp. Trình bày bằng Markdown với tiêu đề theo Chương/Mục/Điều hoặc theo chủ đề/bước thủ tục. Nếu văn bản không có điều khoản pháp lý cụ thể, vẫn giữ lại phần nội dung chính. KHÔNG thêm thông tin không có trong văn bản; KHÔNG diễn giải sai.'

const METADATA_SYSTEM_PROMPT =
  'Bạn là trợ lý trích xuất thông tin văn bản pháp luật. Từ đoạn văn bản được cung cấp, chỉ trả về MỘT đối tượng JSON hợp lệ (không giải thích, không bọc markdown) với các khóa: "title" (tên văn bản hoặc tiêu đề thủ tục), "docNumber" (số hiệu nếu có, ví dụ "27/2023/QH15", hoặc chuỗi rỗng), "issuer" (cơ quan ban hành nếu có, hoặc chuỗi rỗng), "category" (một trong: ' +
  LEGAL_DOC_CATEGORIES.join(', ') +
  '), "keywords" (5-12 chủ đề pháp lý ngắn gọn, mảng chuỗi), "summary" (tối đa 2 câu). KHÔNG thêm thông tin không có trong văn bản.'

/** Input for one fetched page. */
export interface DistillInput {
  pageTitle?: string
  url: string
  text: string
}

/** `distilled=false` means the AI failed and `content` is the cleaned raw text. */
export interface DistillResult {
  content: string
  distilled: boolean
  suggestion: LegalSuggestion
}

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

/**
 * Splits text into windows of at most `size` chars on blank-line paragraph
 * boundaries. A single paragraph longer than `size` is hard-split.
 */
export function splitWindows(text: string, size: number): string[] {
  const paragraphs: string[] = []
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim()
    if (trimmed.length === 0) continue
    for (let start = 0; start < trimmed.length; start += size) {
      paragraphs.push(trimmed.slice(start, start + size))
    }
  }

  const windows: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    const candidate = current === '' ? paragraph : `${current}\n\n${paragraph}`
    if (candidate.length > size && current !== '') {
      windows.push(current)
      current = paragraph
    } else {
      current = candidate
    }
  }
  if (current !== '') windows.push(current)
  return windows
}

/** Parses the metadata reply defensively. Invalid JSON yields an empty suggestion. */
export function parseSuggestion(
  raw: string,
  pageTitle?: string
): LegalSuggestion {
  const parsed = parseJsonObject(raw)
  const title =
    clampString(parsed?.['title'], TITLE_MAX) ??
    clampString(pageTitle, TITLE_MAX)
  const docNumber = clampString(parsed?.['docNumber'], DOC_NUMBER_MAX)
  const issuer = clampString(parsed?.['issuer'], ISSUER_MAX)
  const summary = clampString(parsed?.['summary'], SUMMARY_MAX)
  const category = toCategory(parsed?.['category'])

  return {
    ...(title ? { title } : {}),
    ...(docNumber ? { docNumber } : {}),
    ...(issuer ? { issuer } : {}),
    ...(category ? { category } : {}),
    ...(summary ? { summary } : {}),
    keywords: toKeywords(parsed?.['keywords']),
  }
}

/**
 * Turns the cleaned text of a fetched legal page into a knowledge text plus
 * metadata suggestions via Groq. Never throws: any AI failure falls back to
 * the cleaned raw text with `distilled: false`.
 */
export async function distillLegalPage(
  input: DistillInput,
  pool: GroqKeyPool
): Promise<DistillResult> {
  const allWindows = splitWindows(input.text, DISTILL_WINDOW_CHARS)
  const windows = allWindows.slice(0, DISTILL_MAX_WINDOWS)
  const truncated = allWindows.length > DISTILL_MAX_WINDOWS
  const fallbackSuggestion: LegalSuggestion = {
    keywords: [],
    ...(input.pageTitle ? { title: input.pageTitle } : {}),
  }
  const rawContent = withTruncationNote(windows.join('\n\n'), truncated)

  if (windows.length === 0) {
    return {
      content: rawContent,
      distilled: false,
      suggestion: fallbackSuggestion,
    }
  }

  try {
    const parts: string[] = []
    for (const [index, window] of windows.entries()) {
      const reply = await callGroq(
        pool,
        [
          { role: 'system', content: DISTILL_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Nguồn: ${input.url}\nPhần ${index + 1}/${windows.length}\n\n${window}`,
          },
        ],
        DISTILL_MAX_TOKENS
      )
      parts.push(reply.trim())
    }

    const content = withTruncationNote(
      parts.filter(part => part.length > 0).join('\n\n'),
      truncated
    )
    if (content.length === 0) throw new Error('AI trả về nội dung rỗng')
    const rawLength = windows.join('\n\n').length
    if (
      rawLength >= MIN_RAW_CHARS_FOR_RATIO &&
      content.length < rawLength * MIN_KEPT_RATIO
    ) {
      throw new Error(
        `AI lọc quá tay (${content.length}/${rawLength} ký tự), dùng nội dung thô`
      )
    }

    const metadataReply = await callGroq(
      pool,
      [
        { role: 'system', content: METADATA_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Tiêu đề trang: ${input.pageTitle ?? ''}\nNguồn: ${input.url}\n\n${windows[0] ?? ''}`,
        },
      ],
      METADATA_MAX_TOKENS
    )

    return {
      content,
      distilled: true,
      suggestion: parseSuggestion(metadataReply, input.pageTitle),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Distillation failed, using cleaned raw text: ${message}`)
    return {
      content: rawContent,
      distilled: false,
      suggestion: fallbackSuggestion,
    }
  }
}

async function callGroq(
  pool: GroqKeyPool,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  if (!pool.hasKeys()) throw new Error('Chưa cấu hình khóa Groq')
  const body = JSON.stringify({
    model: DISTILL_MODEL,
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    stream: false,
  })
  const response = await pool.run(DISTILL_MODEL, apiKey =>
    fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    })
  )
  if (!response.ok) {
    throw new Error(`Groq API request failed with status ${response.status}`)
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Phản hồi Groq không có nội dung')
  }
  return content
}

function withTruncationNote(content: string, truncated: boolean): string {
  if (!truncated) return content
  const limit = DISTILL_WINDOW_CHARS * DISTILL_MAX_WINDOWS
  return `${content}\n\n> Ghi chú: trang dài hơn ${limit} ký tự, chỉ phần đầu được chắt lọc. Hãy bổ sung phần còn lại nếu cần.`
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    const value: unknown = JSON.parse(raw.slice(start, end + 1))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function clampString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.slice(0, max)
}

function toCategory(value: unknown): LegalDocCategory | undefined {
  return LEGAL_DOC_CATEGORIES.find(category => category === value)
}

function toKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const keyword = item.trim().slice(0, KEYWORD_MAX)
    const key = keyword.toLocaleLowerCase('vi')
    if (keyword.length === 0 || seen.has(key)) continue
    seen.add(key)
    result.push(keyword)
    if (result.length >= KEYWORDS_MAX) break
  }
  return result
}
