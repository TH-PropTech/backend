import { BadGatewayException, Injectable, Logger } from '@nestjs/common'
import { GroqKeyPool } from '../groq/groq-key-pool.service'
import type {
  EkycOcrBackResult,
  EkycOcrFrontResult,
} from './ekyc-proxy.service'

export const CCCD_OCR_MODEL = 'qwen/qwen3.8-27b'
const GROQ_CHAT_COMPLETIONS_URL =
  'https://api.groq.com/openai/v1/chat/completions'
/** Groq rejects base64 images above 4 MB; stay below it. */
const MAX_IMAGE_BYTES = 3_000_000
const OCR_TIMEOUT_MS = 45_000

const FRONT_PROMPT = [
  'Đây là ảnh MẶT TRƯỚC của thẻ Căn cước / Căn cước công dân Việt Nam.',
  'Đọc chính xác từng ký tự trên thẻ, không đoán và không sửa chính tả.',
  'Chỉ trả về MỘT đối tượng JSON với các khóa:',
  '"idNumber" (số thẻ, chỉ chữ số), "fullName" (họ tên in hoa như trên thẻ),',
  '"dob" (ngày sinh định dạng DD/MM/YYYY), "gender" ("Nam" hoặc "Nữ"),',
  '"nationality" (quốc tịch), "birthplace" (quê quán), "address" (nơi thường trú).',
  'Trường nào không đọc được hoặc ảnh không phải thẻ căn cước thì để chuỗi rỗng.',
].join(' ')

const BACK_PROMPT = [
  'Đây là ảnh MẶT SAU của thẻ Căn cước / Căn cước công dân Việt Nam.',
  'Đọc chính xác từng ký tự trên thẻ, không đoán.',
  'Chỉ trả về MỘT đối tượng JSON với các khóa:',
  '"issueDate" (ngày cấp DD/MM/YYYY), "expiryDate" (có giá trị đến DD/MM/YYYY),',
  '"placeOfBirth" (nơi sinh nếu có), "address" (nơi thường trú nếu có).',
  'Trường nào không đọc được thì để chuỗi rỗng.',
].join(' ')

type JsonRecord = Record<string, unknown>

/**
 * Reads the printed fields of a Vietnamese ID card (front and back) with a Groq
 * vision model. The extracted text is returned to the client and stored with the
 * KYC record; no image is kept by this service.
 */
@Injectable()
export class GroqCccdOcrService {
  private readonly logger = new Logger(GroqCccdOcrService.name)

  constructor(private readonly groqKeyPool: GroqKeyPool) {}

  isAvailable(): boolean {
    return this.groqKeyPool.hasKeys()
  }

  async ocrFront(file: Express.Multer.File): Promise<EkycOcrFrontResult> {
    const fields = await this.extract(file, FRONT_PROMPT)
    const idNumber = digitsOnly(readText(fields, 'idNumber'))
    const fullName = readText(fields, 'fullName')
    const dob = normalizeDate(readText(fields, 'dob'))
    if (!/^(\d{9}|\d{12})$/.test(idNumber) || !fullName || !dob) {
      throw new BadGatewayException('Không đọc được thông tin mặt trước thẻ')
    }
    const gender = normalizeGender(readText(fields, 'gender'))
    const birthplace = readText(fields, 'birthplace')
    const address = readText(fields, 'address')
    return {
      idNumber,
      fullName,
      dob,
      gender,
      nationality: readText(fields, 'nationality') || 'Việt Nam',
      ...(birthplace ? { birthplace } : {}),
      ...(address ? { address } : {}),
    }
  }

  async ocrBack(file: Express.Multer.File): Promise<EkycOcrBackResult> {
    const fields = await this.extract(file, BACK_PROMPT)
    const issueDate = normalizeDate(readText(fields, 'issueDate'))
    const expiryDate = normalizeDate(readText(fields, 'expiryDate'))
    const placeOfBirth = readText(fields, 'placeOfBirth')
    const address = readText(fields, 'address')
    if (!issueDate && !expiryDate && !placeOfBirth && !address) {
      throw new BadGatewayException('Không đọc được thông tin mặt sau thẻ')
    }
    return {
      success: true,
      data: {
        ...(address ? { address } : {}),
        ...(issueDate ? { issueDate } : {}),
        ...(expiryDate ? { expiryDate } : {}),
        ...(placeOfBirth ? { placeOfBirth } : {}),
      },
    }
  }

  private async extract(
    file: Express.Multer.File,
    prompt: string
  ): Promise<JsonRecord> {
    if (!this.groqKeyPool.hasKeys()) {
      throw new BadGatewayException('Chưa cấu hình khóa Groq')
    }
    if (file.buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new BadGatewayException('Ảnh quá lớn để đọc bằng dịch vụ dự phòng')
    }

    const body = JSON.stringify({
      model: CCCD_OCR_MODEL,
      temperature: 0,
      max_completion_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
              },
            },
          ],
        },
      ],
    })

    let response: Response
    try {
      response = await this.groqKeyPool.run(CCCD_OCR_MODEL, apiKey =>
        fetch(GROQ_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
        })
      )
    } catch (error) {
      this.logger.warn(`Groq OCR request failed: ${describe(error)}`)
      throw new BadGatewayException('Dịch vụ đọc thẻ dự phòng không khả dụng')
    }
    if (!response.ok) {
      this.logger.warn(`Groq OCR returned HTTP ${response.status}`)
      throw new BadGatewayException('Dịch vụ đọc thẻ dự phòng không khả dụng')
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>
    }
    const content = payload.choices?.[0]?.message?.content
    const parsed = typeof content === 'string' ? parseJsonObject(content) : null
    if (!parsed) {
      throw new BadGatewayException('Dịch vụ đọc thẻ dự phòng trả dữ liệu lỗi')
    }
    return parsed
  }
}

/** Models may wrap JSON in <think> blocks or code fences; take the first object. */
export function parseJsonObject(text: string): JsonRecord | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(cleaned.slice(start, end + 1))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as JsonRecord)
      : null
  } catch {
    return null
  }
}

function readText(fields: JsonRecord, key: string): string {
  const value = fields[key]
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/** Accepts DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY and YYYY-MM-DD; returns DD/MM/YYYY or ''. */
export function normalizeDate(value: string): string {
  const text = value.trim()
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text)
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  const [day, month, year] = dmy
    ? [dmy[1], dmy[2], dmy[3]]
    : ymd
      ? [ymd[3], ymd[2], ymd[1]]
      : [undefined, undefined, undefined]
  if (!day || !month || !year) return ''
  const d = Number(day)
  const m = Number(month)
  if (d < 1 || d > 31 || m < 1 || m > 12) return ''
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${year}`
}

function normalizeGender(value: string): string {
  const folded = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (folded.startsWith('nu') || folded === 'female') return 'Nữ'
  if (folded.startsWith('nam') || folded === 'male') return 'Nam'
  return ''
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
