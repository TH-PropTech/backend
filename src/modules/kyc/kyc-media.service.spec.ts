import type { ConfigService } from '@nestjs/config'
import { promises as fs } from 'node:fs'

import { KycMediaService } from './kyc-media.service'

jest.mock('node:fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    rm: jest.fn(),
  },
}))

const KEY = '11'.repeat(32)

function createService(): KycMediaService {
  const config = {
    getOrThrow: jest.fn((key: string) =>
      key === 'kyc.mediaEncryptionKey' ? KEY : '.data/kyc-test'
    ),
  } as unknown as ConfigService
  return new KycMediaService(config)
}

function createImage(): Express.Multer.File {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02])
  return {
    fieldname: 'frontCard',
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

describe('KycMediaService', () => {
  const writeFileMock = fs.writeFile as jest.MockedFunction<typeof fs.writeFile>
  const readFileMock = fs.readFile as jest.MockedFunction<typeof fs.readFile>
  const rmMock = fs.rm as jest.MockedFunction<typeof fs.rm>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('encrypts stored image bytes and decrypts them on read', async () => {
    let encrypted = Buffer.alloc(0)
    writeFileMock.mockImplementation((_path, data) => {
      encrypted = Buffer.from(data as Uint8Array)
      return Promise.resolve()
    })
    readFileMock.mockImplementation(() => Promise.resolve(encrypted))
    const service = createService()
    const image = createImage()

    const reference = await service.store(
      '507f1f77bcf86cd799439011',
      'front-card',
      image
    )
    const result = await service.read(reference)

    expect(encrypted.equals(image.buffer)).toBe(false)
    expect(result).toEqual({ buffer: image.buffer, mimetype: 'image/jpeg' })
  })

  it('reads a legacy base64 image without writing it again', async () => {
    const service = createService()

    const result = await service.read('data:image/png;base64,iVBORw0KGgo=')

    expect(result.mimetype).toBe('image/png')
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('removes only a resolved private media reference', async () => {
    const service = createService()

    await service.remove(
      'kyc-media:507f1f77bcf86cd799439011:selfie:123e4567-e89b-42d3-a456-426614174000'
    )
    await service.remove('https://res.cloudinary.com/demo/image.jpg')

    expect(rmMock).toHaveBeenCalledTimes(1)
    expect(rmMock).toHaveBeenCalledWith(
      expect.stringContaining('507f1f77bcf86cd799439011'),
      { force: true }
    )
  })
})
