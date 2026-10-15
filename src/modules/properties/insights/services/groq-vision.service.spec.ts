import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { GroqKeyPool } from '../../../ai/services/groq-key-pool.service'
import { GroqVisionService } from './groq-vision.service'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

function createService(apiKey?: string): GroqVisionService {
  const configService = {
    get: jest.fn().mockReturnValue(apiKey ? [apiKey] : []),
  } as unknown as ConfigService
  return new GroqVisionService(new GroqKeyPool(configService))
}

describe('GroqVisionService', () => {
  const fetchMock = jest.fn<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock
  })

  it('normalizes a valid response with a bounded finding', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                overallCondition: 'attention_needed',
                findings: [
                  {
                    label: 'Moisture',
                    status: 'uncertain',
                    confidence: 0.6,
                    description: 'Possible moisture near the wall.',
                    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
                  },
                ],
                checklist: ['Inspect the wall in person.'],
              }),
            },
          },
        ],
      })
    )

    const result = await createService('groq-key').analyzeCondition(
      Buffer.from('image'),
      'image/jpeg'
    )

    expect(result.overallCondition).toBe('attention_needed')
    expect(result.findings[0]?.status).toBe('uncertain')
    expect(result.findings[0]?.boundingBox).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the provider is not configured or unavailable', async () => {
    await expect(
      createService().analyzeCondition(Buffer.from('image'), 'image/jpeg')
    ).rejects.toBeInstanceOf(ServiceUnavailableException)

    fetchMock.mockResolvedValue(jsonResponse({ error: 'downstream' }, 503))
    await expect(
      createService('groq-key').analyzeCondition(
        Buffer.from('image'),
        'image/jpeg'
      )
    ).rejects.toBeInstanceOf(BadGatewayException)
  })

  it.each([
    { overallCondition: 'unknown', findings: [], checklist: [] },
    {
      overallCondition: 'good',
      findings: [
        {
          label: 'x',
          status: 'detected',
          confidence: 1.1,
          description: 'invalid confidence',
          boundingBox: null,
        },
      ],
      checklist: [],
    },
    {
      overallCondition: 'good',
      findings: [],
      checklist: ['x'.repeat(301)],
    },
  ])('rejects malformed or unsafe provider data', async payload => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      })
    )

    await expect(
      createService('groq-key').analyzeCondition(
        Buffer.from('image'),
        'image/jpeg'
      )
    ).rejects.toBeInstanceOf(BadGatewayException)
  })
})
