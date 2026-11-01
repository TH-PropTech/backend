import { vi } from 'vitest'
import { ServiceUnavailableException } from '@nestjs/common'

import type { StorageService } from '../../../common/storage/storage.service'
import { ApartmentMediaUploadService } from './apartment-media-upload.service'

const PUBLIC_BASE = 'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com'
const KEY_PATTERN =
  /^apartments\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(jpg|png|webp|gif)$/

interface StorageMock {
  isConfigured: boolean
  putObject: ReturnType<typeof vi.fn>
  publicUrl: ReturnType<typeof vi.fn>
}

function buildStorage(isConfigured = true): StorageMock {
  return {
    isConfigured,
    putObject: vi.fn().mockResolvedValue(undefined),
    publicUrl: vi.fn((key: string) => `${PUBLIC_BASE}/${key}`),
  }
}

function buildService(storage: StorageMock): ApartmentMediaUploadService {
  return new ApartmentMediaUploadService(storage as unknown as StorageService)
}

function buildFile(name: string, mimetype: string): Express.Multer.File {
  return {
    originalname: name,
    mimetype,
    buffer: Buffer.from(name),
  } as Express.Multer.File
}

describe('ApartmentMediaUploadService', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uploads each file under apartments/ and returns public urls in order', async () => {
    const storage = buildStorage()
    const service = buildService(storage)

    const urls = await service.uploadImages([
      buildFile('a.jpg', 'image/jpeg'),
      buildFile('b.png', 'image/png'),
    ])

    expect(urls).toHaveLength(2)
    expect(storage.putObject).toHaveBeenCalledTimes(2)
    const [first, second] = storage.putObject.mock.calls.map(
      call => call[0] as { key: string; body: Buffer; contentType: string }
    )
    expect(first?.key).toMatch(KEY_PATTERN)
    expect(first?.key.endsWith('.jpg')).toBe(true)
    expect(first?.contentType).toBe('image/jpeg')
    expect(first?.body).toEqual(Buffer.from('a.jpg'))
    expect(second?.key.endsWith('.png')).toBe(true)
    expect(second?.contentType).toBe('image/png')
    expect(urls).toEqual([
      `${PUBLIC_BASE}/${first?.key}`,
      `${PUBLIC_BASE}/${second?.key}`,
    ])
  })

  it.each([
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['application/octet-stream', 'jpg'],
  ])('maps %s to the .%s extension', async (mimetype, extension) => {
    const storage = buildStorage()
    const service = buildService(storage)

    await service.uploadImages([buildFile('x', mimetype)])

    const { key } = storage.putObject.mock.calls[0]?.[0] as { key: string }
    expect(key.endsWith(`.${extension}`)).toBe(true)
  })

  it('uses a distinct key for every file', async () => {
    const storage = buildStorage()
    const service = buildService(storage)

    const urls = await service.uploadImages([
      buildFile('a.jpg', 'image/jpeg'),
      buildFile('a.jpg', 'image/jpeg'),
    ])

    expect(new Set(urls).size).toBe(2)
  })

  it('returns an empty list without touching storage when no files are given', async () => {
    const storage = buildStorage(false)
    const service = buildService(storage)

    await expect(service.uploadImages([])).resolves.toEqual([])
    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it('fails with 503 and never calls S3 when storage is not configured', async () => {
    const storage = buildStorage(false)
    const service = buildService(storage)

    await expect(
      service.uploadImages([buildFile('a.jpg', 'image/jpeg')])
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it('turns an S3 failure into a 503 without leaking details', async () => {
    const storage = buildStorage()
    storage.putObject.mockRejectedValue(
      new Error('AccessDenied on thproptech-bucket for AKIA-SECRET')
    )
    const service = buildService(storage)

    const error: unknown = await service
      .uploadImages([buildFile('a.jpg', 'image/jpeg')])
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ServiceUnavailableException)
    const message = (error as Error).message
    expect(message).not.toContain('thproptech-bucket')
    expect(message).not.toContain('AKIA')
  })

  it('fails the whole request when one of several uploads fails', async () => {
    const storage = buildStorage()
    storage.putObject
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network down'))
    const service = buildService(storage)

    await expect(
      service.uploadImages([
        buildFile('a.jpg', 'image/jpeg'),
        buildFile('b.jpg', 'image/jpeg'),
      ])
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
