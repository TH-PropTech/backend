import { vi } from 'vitest'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { ConfigService } from '@nestjs/config'

import { StorageService } from './storage.service'

const send = vi.hoisted(() => vi.fn())

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function S3ClientMock() {
    return { send }
  }),
  PutObjectCommand: vi.fn(function PutObjectCommandMock(input: unknown) {
    return { kind: 'put', input }
  }),
  GetObjectCommand: vi.fn(function GetObjectCommandMock(input: unknown) {
    return { kind: 'get', input }
  }),
  DeleteObjectCommand: vi.fn(function DeleteObjectCommandMock(input: unknown) {
    return { kind: 'delete', input }
  }),
}))

const BUCKET = 'thproptech-bucket'
const REGION = 'ap-southeast-1'
const DEFAULT_BASE = `https://${BUCKET}.s3.${REGION}.amazonaws.com`

function createService(
  values: Record<string, string | undefined> = {}
): StorageService {
  const merged: Record<string, string | undefined> = {
    'storage.region': REGION,
    'storage.bucket': BUCKET,
    ...values,
  }
  const config = {
    get: (key: string): string | undefined => merged[key],
  } as unknown as ConfigService
  return new StorageService(config)
}

describe('StorageService', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('configuration', () => {
    it('reports configured when region and bucket are set', () => {
      expect(createService().isConfigured).toBe(true)
    })

    it.each([
      ['region', { 'storage.region': '' }],
      ['bucket', { 'storage.bucket': '' }],
    ])('reports not configured when %s is missing', (_label, override) => {
      const service = createService(override)

      expect(service.isConfigured).toBe(false)
      expect(S3Client).not.toHaveBeenCalled()
    })

    it('passes credentials when both keys are set', () => {
      createService({
        'storage.accessKeyId': 'AKIA-TEST',
        'storage.secretAccessKey': 'secret-test',
      })

      expect(S3Client).toHaveBeenCalledWith({
        region: REGION,
        credentials: {
          accessKeyId: 'AKIA-TEST',
          secretAccessKey: 'secret-test',
        },
      })
    })

    it('falls back to the default credential chain without keys', () => {
      createService()

      expect(S3Client).toHaveBeenCalledWith({ region: REGION })
    })

    it.each([
      ['only the access key id', { 'storage.accessKeyId': 'AKIA-TEST' }],
      ['only the secret', { 'storage.secretAccessKey': 'secret-test' }],
    ])('ignores a half pair of keys (%s)', (_label, override) => {
      createService(override)

      expect(S3Client).toHaveBeenCalledWith({ region: REGION })
    })
  })

  describe('publicUrl', () => {
    it('uses the bucket host when no base url is configured', () => {
      expect(createService().publicUrl('apartments/a.jpg')).toBe(
        `${DEFAULT_BASE}/apartments/a.jpg`
      )
    })

    it('uses the configured base url and trims trailing slashes', () => {
      const service = createService({
        'storage.publicBaseUrl': 'https://cdn.example.com//',
      })

      expect(service.publicUrl('apartments/a.jpg')).toBe(
        'https://cdn.example.com/apartments/a.jpg'
      )
    })
  })

  describe('isOwnPublicUrl', () => {
    it('accepts urls under the public base', () => {
      expect(
        createService().isOwnPublicUrl(`${DEFAULT_BASE}/apartments/a.jpg`)
      ).toBe(true)
    })

    it.each([
      ['another host', 'https://other.example.com/apartments/a.jpg'],
      ['a look-alike prefix', `${DEFAULT_BASE}.evil.com/a.jpg`],
      ['the bare base without a path', DEFAULT_BASE],
    ])('rejects %s', (_label, url) => {
      expect(createService().isOwnPublicUrl(url)).toBe(false)
    })

    it('rejects everything when storage is not configured', () => {
      const service = createService({ 'storage.bucket': '' })

      expect(service.isOwnPublicUrl(`${DEFAULT_BASE}/a.jpg`)).toBe(false)
    })
  })

  describe('object operations', () => {
    it('puts an object with bucket, key, body and content type', async () => {
      send.mockResolvedValue({})
      const body = Buffer.from('image')

      await createService().putObject({
        key: 'apartments/a.jpg',
        body,
        contentType: 'image/jpeg',
      })

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: BUCKET,
        Key: 'apartments/a.jpg',
        Body: body,
        ContentType: 'image/jpeg',
      })
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('returns the object body as a buffer', async () => {
      send.mockResolvedValue({
        Body: {
          transformToByteArray: (): Promise<Uint8Array> =>
            Promise.resolve(new Uint8Array([1, 2, 3])),
        },
      })

      const buffer = await createService().getObject('kyc/u/selfie-1')

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: BUCKET,
        Key: 'kyc/u/selfie-1',
      })
      expect(buffer).toEqual(Buffer.from([1, 2, 3]))
    })

    it('fails when the object has no body', async () => {
      send.mockResolvedValue({})

      await expect(createService().getObject('kyc/u/x')).rejects.toThrow(
        'has no body'
      )
    })

    it('deletes an object by bucket and key', async () => {
      send.mockResolvedValue({})

      await createService().deleteObject('kyc/u/selfie-1')

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: BUCKET,
        Key: 'kyc/u/selfie-1',
      })
    })

    it('refuses every operation when storage is not configured', async () => {
      const service = createService({ 'storage.bucket': '' })

      await expect(
        service.putObject({
          key: 'a',
          body: Buffer.from('x'),
          contentType: 'image/png',
        })
      ).rejects.toThrow('not configured')
      await expect(service.getObject('a')).rejects.toThrow('not configured')
      await expect(service.deleteObject('a')).rejects.toThrow('not configured')
      expect(send).not.toHaveBeenCalled()
    })
  })
})
