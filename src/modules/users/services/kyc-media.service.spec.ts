import { vi } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { promises as fs } from 'node:fs'
import { v2 as cloudinary } from 'cloudinary'

import { KycMediaService } from './kyc-media.service'

vi.mock('node:fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    rm: jest.fn(),
  },
}))

vi.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    url: jest.fn(),
    uploader: { upload_stream: jest.fn(), destroy: jest.fn() },
  },
}))

const KEY = '11'.repeat(32)
const USER_ID = '507f1f77bcf86cd799439011'
const UUID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/

function createService(withCloudinary = false): KycMediaService {
  const cloudValues: Record<string, string> = {
    'cloudinary.cloudName': 'demo-cloud',
    'cloudinary.apiKey': 'key',
    'cloudinary.apiSecret': 'secret',
  }
  const config = {
    getOrThrow: jest.fn((key: string) =>
      key === 'kyc.mediaEncryptionKey' ? KEY : '.data/kyc-test'
    ),
    get: jest.fn((key: string) =>
      withCloudinary ? cloudValues[key] : undefined
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

describe('KycMediaService with Cloudinary', () => {
  const uploadStream = cloudinary.uploader.upload_stream as jest.Mock
  const destroy = cloudinary.uploader.destroy as jest.Mock
  const urlMock = cloudinary.url as jest.Mock
  const writeFileMock = fs.writeFile as jest.MockedFunction<typeof fs.writeFile>
  const fetchSpy = jest.spyOn(global, 'fetch')

  beforeEach(() => {
    jest.clearAllMocks()
    fetchSpy.mockReset()
  })
  afterAll(() => fetchSpy.mockRestore())

  function mockUpload(error: { message: string } | null): { end: jest.Mock } {
    const stream = { end: jest.fn() }
    uploadStream.mockImplementation(
      (
        _options: unknown,
        done: (err: { message: string } | null, res?: unknown) => void
      ) => {
        stream.end.mockImplementation(() =>
          done(error, error ? undefined : { public_id: 'x' })
        )
        return stream
      }
    )
    return stream
  }

  it('uploads the image as a private authenticated asset and returns a cloud reference', async () => {
    const stream = mockUpload(null)
    const image = createImage()

    const reference = await createService(true).store(
      USER_ID,
      'front-card',
      image
    )

    const prefix = `kyc-cloud:${USER_ID}:front-card:`
    expect(reference.startsWith(prefix)).toBe(true)
    const id = reference.slice(prefix.length)
    expect(id).toMatch(UUID_PATTERN)
    const options = (uploadStream.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >
    expect(options).toMatchObject({
      type: 'authenticated',
      resource_type: 'image',
      overwrite: false,
    })
    expect(options.public_id).toBe(`kyc/${USER_ID}/front-card-${id}`)
    expect(stream.end).toHaveBeenCalledWith(image.buffer)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('falls back to encrypted local storage when the upload fails', async () => {
    mockUpload({ message: 'cloud down' })

    const reference = await createService(true).store(
      USER_ID,
      'back-card',
      createImage()
    )

    expect(reference.startsWith('kyc-media:')).toBe(true)
    expect(writeFileMock).toHaveBeenCalledTimes(1)
  })

  it('stores locally when Cloudinary is not configured', async () => {
    const reference = await createService(false).store(
      USER_ID,
      'selfie',
      createImage()
    )

    expect(reference.startsWith('kyc-media:')).toBe(true)
    expect(uploadStream).not.toHaveBeenCalled()
  })

  it('reads a cloud reference through a signed authenticated URL', async () => {
    urlMock.mockReturnValue('https://res.cloudinary.com/demo-cloud/signed')
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb])
    fetchSpy.mockResolvedValue(
      new Response(bytes, { headers: { 'content-type': 'image/jpeg' } })
    )
    const reference = `kyc-cloud:${USER_ID}:front-card:11111111-2222-3333-4444-555555555555`

    const result = await createService(true).read(reference)

    expect(result).toEqual({ buffer: bytes, mimetype: 'image/jpeg' })
    expect(urlMock).toHaveBeenCalledWith(
      `kyc/${USER_ID}/front-card-11111111-2222-3333-4444-555555555555`,
      expect.objectContaining({ type: 'authenticated', sign_url: true })
    )
  })

  it('rejects a cloud read that fails or returns a non-image', async () => {
    urlMock.mockReturnValue('https://res.cloudinary.com/demo-cloud/signed')
    const reference = `kyc-cloud:${USER_ID}:selfie:11111111-2222-3333-4444-555555555555`
    const service = createService(true)

    fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 404 }))
    await expect(service.read(reference)).rejects.toThrow(
      'Không thể đọc ảnh KYC đã lưu'
    )

    fetchSpy.mockResolvedValueOnce(
      new Response('<html>', { headers: { 'content-type': 'text/html' } })
    )
    await expect(service.read(reference)).rejects.toThrow(
      'Định dạng ảnh KYC đã lưu không hợp lệ'
    )
  })

  it('rejects a malformed cloud reference', async () => {
    await expect(
      createService(true).read('kyc-cloud:not-valid')
    ).rejects.toThrow('Tham chiếu ảnh KYC không hợp lệ')
  })

  it('destroys the private asset on remove and never throws', async () => {
    destroy.mockRejectedValueOnce(new Error('boom'))
    const reference = `kyc-cloud:${USER_ID}:front-card:11111111-2222-3333-4444-555555555555`

    await expect(createService(true).remove(reference)).resolves.toBeUndefined()
    expect(destroy).toHaveBeenCalledWith(
      `kyc/${USER_ID}/front-card-11111111-2222-3333-4444-555555555555`,
      expect.objectContaining({ type: 'authenticated', invalidate: true })
    )
  })
})
