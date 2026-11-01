import { vi } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { promises as fs } from 'node:fs'

import type { StorageService } from '../../../common/storage/storage.service'
import { KycMediaService } from './kyc-media.service'

vi.mock('node:fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    rm: jest.fn(),
  },
}))

const KEY = '11'.repeat(32)
const USER_ID = '507f1f77bcf86cd799439011'
const UUID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const SAMPLE_ID = '11111111-2222-3333-4444-555555555555'

interface StorageMock {
  isConfigured: boolean
  putObject: ReturnType<typeof vi.fn>
  getObject: ReturnType<typeof vi.fn>
  deleteObject: ReturnType<typeof vi.fn>
}

function createStorage(isConfigured: boolean): StorageMock {
  return {
    isConfigured,
    putObject: vi.fn().mockResolvedValue(undefined),
    getObject: vi.fn(),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  }
}

function createService(storage: StorageMock): KycMediaService {
  const config = {
    getOrThrow: jest.fn((key: string) =>
      key === 'kyc.mediaEncryptionKey' ? KEY : '.data/kyc-test'
    ),
  } as unknown as ConfigService
  return new KycMediaService(config, storage as unknown as StorageService)
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
    const service = createService(createStorage(false))
    const image = createImage()

    const reference = await service.store(USER_ID, 'front-card', image)
    const result = await service.read(reference)

    expect(encrypted.equals(image.buffer)).toBe(false)
    expect(result).toEqual({ buffer: image.buffer, mimetype: 'image/jpeg' })
  })

  it('reads a legacy base64 image without writing it again', async () => {
    const service = createService(createStorage(false))

    const result = await service.read('data:image/png;base64,iVBORw0KGgo=')

    expect(result.mimetype).toBe('image/png')
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('removes only a resolved private media reference', async () => {
    const service = createService(createStorage(false))

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

  it('rejects a user id that is not 24 hex characters before storing', async () => {
    const storage = createStorage(true)

    await expect(
      createService(storage).store('../etc', 'selfie', createImage())
    ).rejects.toThrow('ID người dùng không hợp lệ')
    expect(storage.putObject).not.toHaveBeenCalled()
    expect(writeFileMock).not.toHaveBeenCalled()
  })
})

describe('KycMediaService with S3', () => {
  const writeFileMock = fs.writeFile as jest.MockedFunction<typeof fs.writeFile>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  async function storeAndCapture(
    storage: StorageMock,
    kind: 'front-card' | 'back-card' | 'selfie' = 'front-card'
  ): Promise<{
    reference: string
    envelope: Buffer
    image: Express.Multer.File
  }> {
    const image = createImage()
    const reference = await createService(storage).store(USER_ID, kind, image)
    const call = storage.putObject.mock.calls[0]?.[0] as { body: Buffer }
    return { reference, envelope: call.body, image }
  }

  it('stores an encrypted envelope under kyc/ and returns a kyc-s3 reference', async () => {
    const storage = createStorage(true)

    const { reference, envelope, image } = await storeAndCapture(storage)

    const prefix = `kyc-s3:${USER_ID}:front-card:`
    expect(reference.startsWith(prefix)).toBe(true)
    const id = reference.slice(prefix.length)
    expect(id).toMatch(UUID_PATTERN)
    expect(storage.putObject).toHaveBeenCalledWith({
      key: `kyc/${USER_ID}/front-card-${id}`,
      body: envelope,
      contentType: 'application/octet-stream',
    })
    expect(envelope.includes(image.buffer)).toBe(false)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('reads a kyc-s3 reference back through decryption', async () => {
    const storage = createStorage(true)
    const { reference, envelope, image } = await storeAndCapture(storage)
    storage.getObject.mockResolvedValue(envelope)

    const result = await createService(storage).read(reference)

    expect(result).toEqual({ buffer: image.buffer, mimetype: 'image/jpeg' })
    expect(storage.getObject).toHaveBeenCalledWith(
      reference.replace(
        `kyc-s3:${USER_ID}:front-card:`,
        `kyc/${USER_ID}/front-card-`
      )
    )
  })

  it('rejects a stored object that is corrupt or was encrypted with another key', async () => {
    const storage = createStorage(true)
    const { reference, envelope } = await storeAndCapture(storage)
    const tampered = Buffer.from(envelope)
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff
    storage.getObject.mockResolvedValue(tampered)

    await expect(createService(storage).read(reference)).rejects.toThrow(
      'Không thể giải mã ảnh KYC đã lưu'
    )
  })

  it('maps an S3 read failure to a generic 502 message', async () => {
    const storage = createStorage(true)
    storage.getObject.mockRejectedValue(
      new Error('NoSuchKey thproptech-bucket')
    )
    const reference = `kyc-s3:${USER_ID}:selfie:${SAMPLE_ID}`

    const error: unknown = await createService(storage)
      .read(reference)
      .catch((caught: unknown) => caught)

    expect((error as Error).message).toBe('Không thể đọc ảnh KYC đã lưu')
  })

  it.each([
    ['not-valid'],
    [`${USER_ID}:passport:${SAMPLE_ID}`],
    [`../../etc:selfie:${SAMPLE_ID}`],
  ])(
    'rejects the malformed kyc-s3 reference %s without calling S3',
    async tail => {
      const storage = createStorage(true)
      const service = createService(storage)

      await expect(service.read(`kyc-s3:${tail}`)).rejects.toThrow(
        'Tham chiếu ảnh KYC không hợp lệ'
      )
      await expect(service.remove(`kyc-s3:${tail}`)).rejects.toThrow(
        'Tham chiếu ảnh KYC không hợp lệ'
      )
      expect(storage.getObject).not.toHaveBeenCalled()
      expect(storage.deleteObject).not.toHaveBeenCalled()
    }
  )

  it('deletes the object on remove and only logs a delete failure', async () => {
    const storage = createStorage(true)
    storage.deleteObject.mockRejectedValueOnce(new Error('boom'))
    const reference = `kyc-s3:${USER_ID}:front-card:${SAMPLE_ID}`

    await expect(
      createService(storage).remove(reference)
    ).resolves.toBeUndefined()
    expect(storage.deleteObject).toHaveBeenCalledWith(
      `kyc/${USER_ID}/front-card-${SAMPLE_ID}`
    )
  })

  it('falls back to encrypted local storage when the S3 write fails', async () => {
    const storage = createStorage(true)
    storage.putObject.mockRejectedValue(new Error('s3 down'))

    const reference = await createService(storage).store(
      USER_ID,
      'back-card',
      createImage()
    )

    expect(reference.startsWith('kyc-media:')).toBe(true)
    expect(writeFileMock).toHaveBeenCalledTimes(1)
  })

  it('stores locally when S3 is not configured', async () => {
    const storage = createStorage(false)

    const reference = await createService(storage).store(
      USER_ID,
      'selfie',
      createImage()
    )

    expect(reference.startsWith('kyc-media:')).toBe(true)
    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it('refuses to read an http(s) url as a KYC image', async () => {
    const storage = createStorage(true)

    await expect(
      createService(storage).read('https://res.cloudinary.com/demo/image.jpg')
    ).rejects.toThrow('Nguồn ảnh KYC không được hỗ trợ')
    expect(storage.getObject).not.toHaveBeenCalled()
  })

  it('refuses the removed kyc-cloud reference format with a 400', async () => {
    const storage = createStorage(true)

    await expect(
      createService(storage).read(
        `kyc-cloud:${USER_ID}:front-card:${SAMPLE_ID}`
      )
    ).rejects.toThrow('Tham chiếu ảnh KYC không còn được hỗ trợ')
    expect(storage.getObject).not.toHaveBeenCalled()
  })
})
