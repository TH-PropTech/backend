import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type {
  ConditionFinding,
  ConditionFindingStatus,
  NormalizedBoundingBox,
  OverallCondition,
} from './schemas/condition-analysis.schema'

const GROQ_VISION_MODEL = 'qwen/qwen3.6-27b'
const GROQ_CHAT_COMPLETIONS_URL =
  'https://api.groq.com/openai/v1/chat/completions'
const FINDING_STATUSES: ConditionFindingStatus[] = [
  'detected',
  'uncertain',
  'not_detected',
]
const OVERALL_CONDITIONS: OverallCondition[] = [
  'good',
  'attention_needed',
  'uncertain',
]

interface GroqChoice {
  message?: { content?: string }
}

interface GroqResponse {
  choices?: GroqChoice[]
}

interface VisionAnalysisResult {
  findings: ConditionFinding[]
  overallCondition: OverallCondition
  checklist: string[]
  model: string
}

@Injectable()
export class GroqVisionService {
  constructor(private readonly configService: ConfigService) {}

  async analyzeCondition(
    image: Buffer,
    mimeType: string
  ): Promise<VisionAnalysisResult> {
    const apiKey = this.configService.get<string>('groq.apiKey')
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Condition analysis is not configured'
      )
    }

    let response: Response
    try {
      response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_VISION_MODEL,
          temperature: 0,
          max_completion_tokens: 1200,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: [
                    'Inspect this property image for visible condition issues.',
                    'Return JSON only with findings, overallCondition and checklist.',
                    'Each finding must contain label, status, confidence, description and boundingBox.',
                    'status must be detected, uncertain, or not_detected.',
                    'confidence must be between 0 and 1.',
                    'boundingBox is null or normalized x, y, width and height values between 0 and 1.',
                    'overallCondition must be good, attention_needed, or uncertain.',
                    'checklist must be an array of short follow-up checks grounded in visible or uncertain findings.',
                    'Do not infer defects that are not visible. Use uncertain when image evidence is insufficient.',
                  ].join(' '),
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${image.toString('base64')}`,
                  },
                },
              ],
            },
          ],
        }),
      })
    } catch (error) {
      throw new BadGatewayException(
        'Condition analysis provider is unavailable',
        { cause: error }
      )
    }

    if (!response.ok) {
      throw new BadGatewayException('Condition analysis provider failed')
    }

    const payload: unknown = await response.json()
    return this.parseResponse(payload)
  }

  private parseResponse(payload: unknown): VisionAnalysisResult {
    if (!isRecord(payload)) {
      throw new BadGatewayException('Condition analysis returned invalid data')
    }

    const response = payload as GroqResponse
    const content = response.choices?.[0]?.message?.content
    if (!content) {
      throw new BadGatewayException('Condition analysis returned no result')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (error) {
      throw new BadGatewayException(
        'Condition analysis returned invalid JSON',
        { cause: error }
      )
    }

    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed.findings) ||
      parsed.findings.length > 25 ||
      !Array.isArray(parsed.checklist) ||
      parsed.checklist.length > 20 ||
      !parsed.checklist.every(
        item =>
          typeof item === 'string' &&
          item.trim().length > 0 &&
          item.trim().length <= 300
      )
    ) {
      throw new BadGatewayException('Condition analysis returned invalid data')
    }

    const overallCondition = parsed.overallCondition
    if (
      typeof overallCondition !== 'string' ||
      !OVERALL_CONDITIONS.includes(overallCondition as OverallCondition)
    ) {
      throw new BadGatewayException('Condition analysis returned invalid data')
    }

    const findings = parsed.findings.map(finding => this.parseFinding(finding))
    return {
      findings,
      overallCondition: overallCondition as OverallCondition,
      checklist: parsed.checklist.map(item => (item as string).trim()),
      model: GROQ_VISION_MODEL,
    }
  }

  private parseFinding(value: unknown): ConditionFinding {
    if (!isRecord(value)) {
      throw new BadGatewayException('Condition analysis returned invalid data')
    }

    const { label, status, confidence, description, boundingBox } = value
    if (
      typeof label !== 'string' ||
      !label.trim() ||
      label.trim().length > 100 ||
      typeof status !== 'string' ||
      !FINDING_STATUSES.includes(status as ConditionFindingStatus) ||
      typeof confidence !== 'number' ||
      confidence < 0 ||
      confidence > 1 ||
      typeof description !== 'string' ||
      !description.trim() ||
      description.trim().length > 500
    ) {
      throw new BadGatewayException('Condition analysis returned invalid data')
    }

    return {
      label: label.trim(),
      status: status as ConditionFindingStatus,
      confidence,
      description: description.trim(),
      boundingBox: this.parseBoundingBox(boundingBox),
    }
  }

  private parseBoundingBox(value: unknown): NormalizedBoundingBox | null {
    if (value === null || value === undefined) return null
    if (!isRecord(value)) {
      throw new BadGatewayException('Condition analysis returned invalid data')
    }

    const coordinates = [value.x, value.y, value.width, value.height]
    if (
      coordinates.some(
        coordinate =>
          typeof coordinate !== 'number' || coordinate < 0 || coordinate > 1
      ) ||
      (value.x as number) + (value.width as number) > 1 ||
      (value.y as number) + (value.height as number) > 1
    ) {
      throw new BadGatewayException('Condition analysis returned invalid data')
    }

    return {
      x: value.x as number,
      y: value.y as number,
      width: value.width as number,
      height: value.height as number,
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
