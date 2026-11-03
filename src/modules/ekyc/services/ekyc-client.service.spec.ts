import {
  BadGatewayException,
  GatewayTimeoutException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { normalizeDate } from '../utils/ekyc-normalize.util'
import { EkycClient } from './ekyc-client.service'

function createImage(fieldname = 'frontID'): Express.Multer.File {
  const buffer = Buffer.alloc(4, 0xff)
  return {
    fieldname,
    originalname: `${fieldname}.jpg`,
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as unknown as Express.Multer.File['stream'],
  }
}

function upstream(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createClient(): EkycClient {
  const values: Record<string, unknown> = {
    'ekyc.serviceUrl': 'http://ekyc.test:8000/',
    'ekyc.requestTimeoutMs': 5000,
  }
  const config = {
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService
  return new EkycClient(config)
}

const FACE_OK = {
  liveness: true,
  spoofScore: 0.12,
  match: true,
  distance: 0.4,
  threshold: 0.85,
  embedding: [0.1, 0.2],
}

describe('EkycClient', () => {
  const fetchSpy = jest.spyOn(global, 'fetch')

  afterEach(() => fetchSpy.mockReset())
  afterAll(() => fetchSpy.mockRestore())

  it('reads the front of the card and normalises the fields', async () => {
    fetchSpy.mockResolvedValue(
      upstream({
        result: {
          idNumber: '079 123 456 789',
          fullName: '  NGUYỄN VĂN A ',
          dob: '1-2-2000',
          gender: 'nam',
          nationality: '',
          birthplace: 'TP Hồ Chí Minh',
        },
      })
    )

    await expect(createClient().ocrFront(createImage())).resolves.toEqual({
      idNumber: '079123456789',
      fullName: 'NGUYỄN VĂN A',
      dob: '01/02/2000',
      gender: 'Nam',
      nationality: 'Việt Nam',
      birthplace: 'TP Hồ Chí Minh',
    })
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://ekyc.test:8000/api/ocr/front'
    )
  })

  it('turns an unreadable front into a user-fixable 422', async () => {
    fetchSpy.mockResolvedValue(
      upstream({ result: { idNumber: '12', fullName: 'A', dob: '' } })
    )

    await expect(createClient().ocrFront(createImage())).rejects.toBeInstanceOf(
      UnprocessableEntityException
    )
  })

  it('maps the new-card back result to the existing back shape', async () => {
    fetchSpy.mockResolvedValue(
      upstream({
        result: {
          version: 'new',
          address: 'Quận 1',
          issueDate: '2021-05-04',
          expiryDate: '04/05/2036',
          placeOfBirth: 'Hà Nội',
        },
      })
    )

    await expect(
      createClient().ocrBack(createImage('backID'))
    ).resolves.toEqual({
      success: true,
      version: 'new',
      data: {
        address: 'Quận 1',
        issueDate: '04/05/2021',
        expiryDate: '04/05/2036',
        placeOfBirth: 'Hà Nội',
      },
    })
  })

  it('keeps only the issue date for an old card', async () => {
    fetchSpy.mockResolvedValue(
      upstream({
        result: {
          version: 'old',
          issueDate: '04/05/2015',
          address: 'ignored',
        },
      })
    )

    await expect(
      createClient().ocrBack(createImage('backID'))
    ).resolves.toEqual({
      success: true,
      version: 'old',
      data: { issueDate: '04/05/2015' },
    })
  })

  it('returns the face result without the embedding', async () => {
    fetchSpy.mockResolvedValue(upstream({ result: FACE_OK }))

    const result = await createClient().verifyFace(
      createImage('selfie'),
      createImage()
    )

    expect(result).toEqual({
      liveness: true,
      spoofScore: 0.12,
      match: true,
      distance: 0.4,
      threshold: 0.85,
    })
    expect(result).not.toHaveProperty('embedding')
  })

  it('passes an upstream 422 message through as a 422', async () => {
    fetchSpy.mockResolvedValue(
      upstream({ error: 'Không tìm thấy khuôn mặt' }, 422)
    )

    await expect(
      createClient().verifyFace(createImage('selfie'), createImage())
    ).rejects.toMatchObject({
      status: 422,
      message: 'Không tìm thấy khuôn mặt',
    })
  })

  it('maps an upstream 5xx to 502', async () => {
    fetchSpy.mockResolvedValue(upstream({ error: 'x' }, 500))

    await expect(createClient().ocrFront(createImage())).rejects.toBeInstanceOf(
      BadGatewayException
    )
  })

  it('maps an upstream 400 to an internal error', async () => {
    fetchSpy.mockResolvedValue(upstream({ error: 'bad' }, 400))

    await expect(createClient().ocrFront(createImage())).rejects.toBeInstanceOf(
      InternalServerErrorException
    )
  })

  it('maps a network failure to 502', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'))

    await expect(createClient().ocrFront(createImage())).rejects.toBeInstanceOf(
      BadGatewayException
    )
  })

  it('maps a timeout to 504', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    fetchSpy.mockRejectedValue(timeout)

    await expect(createClient().ocrFront(createImage())).rejects.toBeInstanceOf(
      GatewayTimeoutException
    )
  })

  it('maps a malformed payload to 502', async () => {
    fetchSpy.mockResolvedValue(upstream({ result: { liveness: 'yes' } }))

    await expect(
      createClient().verifyFace(createImage('selfie'), createImage())
    ).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('maps a 200 without a result object to 502', async () => {
    fetchSpy.mockResolvedValue(upstream({ unexpected: true }))

    await expect(createClient().ocrFront(createImage())).rejects.toBeInstanceOf(
      BadGatewayException
    )
  })
})

describe('normalizeDate', () => {
  it('normalises separators and ISO dates', () => {
    expect(normalizeDate('1-2-2000')).toBe('01/02/2000')
    expect(normalizeDate('2000-02-01')).toBe('01/02/2000')
    expect(normalizeDate('31/13/2000')).toBe('')
  })
})
