import { ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { v2 as cloudinary } from 'cloudinary'
import { ApartmentMediaUploadService } from './apartment-media-upload.service'

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: { upload_stream: jest.fn() },
  },
}))

type UploadCallback = (
  error: Error | undefined,
  result: { secure_url: string } | undefined
) => void

const uploadStream = cloudinary.uploader.upload_stream as unknown as jest.Mock

function buildFile(name: string): Express.Multer.File {
  return {
    originalname: name,
    buffer: Buffer.from(name),
  } as Express.Multer.File
}

function buildService(
  values: Record<string, string | undefined>
): ApartmentMediaUploadService {
  const configService = {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService
  return new ApartmentMediaUploadService(configService)
}

const configured = {
  'cloudinary.cloudName': 'demo',
  'cloudinary.apiKey': 'key',
  'cloudinary.apiSecret': 'secret',
}

describe('ApartmentMediaUploadService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uploads each file to the apartments folder and returns secure urls', async () => {
    uploadStream.mockImplementation(
      (_options: unknown, callback: UploadCallback) => ({
        end: (buffer: Buffer): void =>
          callback(undefined, {
            secure_url: `https://res.cloudinary.com/demo/${buffer.toString()}`,
          }),
      })
    )
    const service = buildService(configured)

    const urls = await service.uploadImages([
      buildFile('a.jpg'),
      buildFile('b.png'),
    ])

    expect(urls).toEqual([
      'https://res.cloudinary.com/demo/a.jpg',
      'https://res.cloudinary.com/demo/b.png',
    ])
    expect(cloudinary.config).toHaveBeenCalledWith(
      expect.objectContaining({
        cloud_name: 'demo',
        api_key: 'key',
        api_secret: 'secret',
        secure: true,
      })
    )
    expect(uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'apartments', resource_type: 'image' }),
      expect.any(Function)
    )
  })

  it('returns an empty list without calling Cloudinary when no files are given', async () => {
    const service = buildService(configured)

    await expect(service.uploadImages([])).resolves.toEqual([])
    expect(uploadStream).not.toHaveBeenCalled()
  })

  it.each([
    'cloudinary.cloudName',
    'cloudinary.apiKey',
    'cloudinary.apiSecret',
  ])('fails with 503 when %s is not configured', async missingKey => {
    const service = buildService({ ...configured, [missingKey]: '' })

    await expect(
      service.uploadImages([buildFile('a.jpg')])
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(uploadStream).not.toHaveBeenCalled()
  })

  it('turns a Cloudinary failure into a 503 without leaking details', async () => {
    uploadStream.mockImplementation(
      (_options: unknown, callback: UploadCallback) => ({
        end: (): void =>
          callback(new Error('invalid api_secret abc'), undefined),
      })
    )
    const service = buildService(configured)

    const error: unknown = await service
      .uploadImages([buildFile('a.jpg')])
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ServiceUnavailableException)
    expect((error as Error).message).not.toContain('api_secret')
  })

  it('fails when Cloudinary returns neither an error nor a result', async () => {
    uploadStream.mockImplementation(
      (_options: unknown, callback: UploadCallback) => ({
        end: (): void => callback(undefined, undefined),
      })
    )
    const service = buildService(configured)

    await expect(
      service.uploadImages([buildFile('a.jpg')])
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
