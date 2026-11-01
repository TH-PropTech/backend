import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export interface PutObjectInput {
  readonly key: string
  readonly body: Buffer
  readonly contentType: string
}

/**
 * S3 access shared by every module that stores files. Credentials are optional:
 * on EC2 the SDK falls back to the instance role.
 */
@Injectable()
export class StorageService {
  private readonly bucket: string
  private readonly publicBaseUrl: string
  private readonly client: S3Client | null

  constructor(configService: ConfigService) {
    const region = configService.get<string>('storage.region') ?? ''
    const accessKeyId = configService.get<string>('storage.accessKeyId')
    const secretAccessKey = configService.get<string>('storage.secretAccessKey')
    this.bucket = configService.get<string>('storage.bucket') ?? ''
    const configuredBase = configService.get<string>('storage.publicBaseUrl')
    this.publicBaseUrl = (
      configuredBase || `https://${this.bucket}.s3.${region}.amazonaws.com`
    ).replace(/\/+$/, '')
    this.client =
      this.bucket && region
        ? new S3Client({
            region,
            ...(accessKeyId && secretAccessKey
              ? { credentials: { accessKeyId, secretAccessKey } }
              : {}),
          })
        : null
  }

  get isConfigured(): boolean {
    return this.client !== null
  }

  async putObject(input: PutObjectInput): Promise<void> {
    await this.requireClient().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      })
    )
  }

  async getObject(key: string): Promise<Buffer> {
    const response = await this.requireClient().send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    )
    if (!response.Body) throw new Error(`S3 object ${key} has no body`)
    return Buffer.from(await response.Body.transformToByteArray())
  }

  async deleteObject(key: string): Promise<void> {
    await this.requireClient().send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    )
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`
  }

  isOwnPublicUrl(url: string): boolean {
    return this.isConfigured && url.startsWith(`${this.publicBaseUrl}/`)
  }

  private requireClient(): S3Client {
    if (!this.client) throw new Error('S3 storage is not configured')
    return this.client
  }
}
