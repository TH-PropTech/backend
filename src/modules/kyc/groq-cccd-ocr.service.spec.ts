import { BadGatewayException } from '@nestjs/common'
import type { GroqKeyPool } from '../groq/groq-key-pool.service'
import {
  GroqCccdOcrService,
  normalizeDate,
  parseJsonObject,
} from './groq-cccd-ocr.service'

function createImage(size = 4): Express.Multer.File {
  const buffer = Buffer.alloc(size, 0xff)
  return {
    fieldname: 'frontID',
    originalname: 'front.jpg',
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

function groqReply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createService(hasKeys = true): GroqCccdOcrService {
  const pool = {
    hasKeys: () => hasKeys,
    run: jest.fn(
      (_model: string, request: (key: string) => Promise<Response>) =>
        request('gsk_test_key')
    ),
  } as unknown as GroqKeyPool
  return new GroqCccdOcrService(pool)
}

describe('GroqCccdOcrService', () => {
  const fetchSpy = jest.spyOn(global, 'fetch')

  afterEach(() => fetchSpy.mockReset())
  afterAll(() => fetchSpy.mockRestore())

  it('reads the front of the card and normalises the fields', async () => {
    fetchSpy.mockResolvedValue(
      groqReply(
        JSON.stringify({
          idNumber: '079 123 456 789',
          fullName: '  NGUYỄN VĂN A ',
          dob: '1-2-2000',
          gender: 'nam',
          nationality: '',
          birthplace: 'TP Hồ Chí Minh',
          address: '',
        })
      )
    )

    const result = await createService().ocrFront(createImage())

    expect(result).toEqual({
      idNumber: '079123456789',
      fullName: 'NGUYỄN VĂN A',
      dob: '01/02/2000',
      gender: 'Nam',
      nationality: 'Việt Nam',
      birthplace: 'TP Hồ Chí Minh',
    })
    const init = fetchSpy.mock.calls[0]?.[1]
    const body = JSON.parse(
      typeof init?.body === 'string' ? init.body : '{}'
    ) as {
      model: string
      messages: Array<{ content: Array<{ type: string }> }>
    }
    expect(body.model).toBe('qwen/qwen3.8-27b')
    expect(body.messages[0]?.content.map(part => part.type)).toEqual([
      'text',
      'image_url',
    ])
  })

  it('accepts JSON wrapped in think blocks and code fences', async () => {
    fetchSpy.mockResolvedValue(
      groqReply(
        '<think>đang đọc</think>\n```json\n{"idNumber":"079123456789","fullName":"TRẦN B","dob":"2000-12-31","gender":"Nữ"}\n```'
      )
    )

    const result = await createService().ocrFront(createImage())

    expect(result).toMatchObject({
      idNumber: '079123456789',
      fullName: 'TRẦN B',
      dob: '31/12/2000',
      gender: 'Nữ',
    })
  })

  it('rejects a front result whose id number is not 9 or 12 digits', async () => {
    fetchSpy.mockResolvedValue(
      groqReply('{"idNumber":"12345","fullName":"A","dob":"01/01/2000"}')
    )

    await expect(
      createService().ocrFront(createImage())
    ).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('rejects a front result without a name or birth date', async () => {
    fetchSpy.mockResolvedValue(
      groqReply('{"idNumber":"079123456789","fullName":"","dob":""}')
    )

    await expect(
      createService().ocrFront(createImage())
    ).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('reads the back of the card', async () => {
    fetchSpy.mockResolvedValue(
      groqReply(
        '{"issueDate":"10/07/2021","expiryDate":"","placeOfBirth":"Hà Nội","address":"Quận 1, TP HCM"}'
      )
    )

    const result = await createService().ocrBack(createImage())

    expect(result).toEqual({
      success: true,
      data: {
        address: 'Quận 1, TP HCM',
        issueDate: '10/07/2021',
        placeOfBirth: 'Hà Nội',
      },
    })
  })

  it('rejects a back result with nothing readable', async () => {
    fetchSpy.mockResolvedValue(
      groqReply(
        '{"issueDate":"","expiryDate":"","placeOfBirth":"","address":""}'
      )
    )

    await expect(createService().ocrBack(createImage())).rejects.toBeInstanceOf(
      BadGatewayException
    )
  })

  it('fails when no Groq key is configured, without calling the API', async () => {
    await expect(
      createService(false).ocrFront(createImage())
    ).rejects.toBeInstanceOf(BadGatewayException)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects images above the 3 MB provider limit without calling the API', async () => {
    await expect(
      createService().ocrFront(createImage(3_000_001))
    ).rejects.toBeInstanceOf(BadGatewayException)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('maps provider errors and non-JSON replies to a gateway error', async () => {
    fetchSpy.mockResolvedValueOnce(groqReply('boom', 500))
    await expect(
      createService().ocrFront(createImage())
    ).rejects.toBeInstanceOf(BadGatewayException)

    fetchSpy.mockResolvedValueOnce(groqReply('không đọc được ảnh này'))
    await expect(createService().ocrBack(createImage())).rejects.toBeInstanceOf(
      BadGatewayException
    )

    fetchSpy.mockRejectedValueOnce(new Error('network down'))
    await expect(createService().ocrBack(createImage())).rejects.toBeInstanceOf(
      BadGatewayException
    )
  })
})

describe('normalizeDate', () => {
  it.each([
    ['01/02/2000', '01/02/2000'],
    ['1-2-2000', '01/02/2000'],
    ['01.02.2000', '01/02/2000'],
    ['2000-02-01', '01/02/2000'],
    ['32/01/2000', ''],
    ['01/13/2000', ''],
    ['không rõ', ''],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected)
  })
})

describe('parseJsonObject', () => {
  it('returns null for arrays, invalid JSON and text without braces', () => {
    expect(parseJsonObject('[1,2]')).toBeNull()
    expect(parseJsonObject('{không phải json}')).toBeNull()
    expect(parseJsonObject('chỉ là chữ')).toBeNull()
  })
})
