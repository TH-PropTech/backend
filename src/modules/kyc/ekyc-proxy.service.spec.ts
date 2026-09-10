import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'

import { EkycProxyService } from './ekyc-proxy.service'

const SERVICE_URL = 'https://ekyc.example.com'

function createFile(
  name = 'identity.jpg',
  bytes: readonly number[] = [0xff, 0xd8, 0xff, 0xdb]
): Express.Multer.File {
  return {
    fieldname: 'image',
    originalname: name,
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: bytes.length,
    buffer: Buffer.from(bytes),
    destination: '',
    filename: name,
    path: '',
    stream: undefined as unknown as Express.Multer.File['stream'],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue('upstream failure'),
  } as unknown as Response
}

function createService(): EkycProxyService {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(SERVICE_URL),
    get: jest.fn().mockReturnValue(60000),
  } as unknown as ConfigService

  return new EkycProxyService(configService)
}

describe('EkycProxyService', () => {
  const fetchMock = jest.fn<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('normalizes a valid front OCR response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: {
          idNumber: '079123456789',
          fullName: 'NGUYEN VAN A',
          dob: '01/01/2000',
          gender: 'Nam',
          nationality: 'Viet Nam',
          birthplace: 'TP HCM',
          address: 'TP HCM',
        },
      })
    )

    const result = await createService().ocrFront(createFile())

    expect(result.idNumber).toBe('079123456789')
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVICE_URL}/api/ekyc/frontID`,
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('normalizes a valid biometric response without inventing an OCR score', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: {
          success: true,
          liveness: true,
          face_matching: true,
          spoof_score: 0.91,
          motion_variance: 0.4,
          frames_processed: 1,
        },
      })
    )

    const result = await createService().verifyFace(createFile(), createFile())

    expect(result).toEqual({
      verified: true,
      faceMatch: true,
      liveness: true,
      realConfidence: 0.91,
      motionVariance: 0.4,
      framesProcessed: 1,
    })
    expect(result).not.toHaveProperty('ocrMatchRate')
  })

  it('fails closed when upstream returns a non-success status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'internal path' }, 503))

    await expect(createService().ocrBack(createFile())).rejects.toBeInstanceOf(
      BadGatewayException
    )
  })

  it('fails closed when upstream returns malformed OCR data', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: { fullName: 42 } }))

    await expect(createService().ocrFront(createFile())).rejects.toBeInstanceOf(
      BadGatewayException
    )
  })

  it('maps an aborted upstream request to a gateway timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('timed out', 'AbortError'))

    await expect(
      createService().verifyFace(createFile(), createFile())
    ).rejects.toBeInstanceOf(GatewayTimeoutException)
  })
})
