import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import { StorageService } from '../../../common/storage/storage.service'
import { validateKycImage } from '../utils/kyc-image.util'

export type KycMediaKind = 'front-card' | 'back-card' | 'selfie'

export interface KycMediaContent {
  readonly buffer: Buffer
  readonly mimetype: 'image/jpeg' | 'image/png'
}

const MEDIA_REFERENCE_PATTERN =
  /^kyc-media:([a-f\d]{24}):(front-card|back-card|selfie):([a-f\d-]{36})$/i
const S3_REFERENCE_PATTERN =
  /^kyc-s3:([a-f\d]{24}):(front-card|back-card|selfie):([a-f\d-]{36})$/i
const S3_KYC_PREFIX = 'kyc'
const ENCRYPTED_CONTENT_TYPE = 'application/octet-stream'
const ENVELOPE_VERSION = 1
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

@Injectable()
export class KycMediaService {
  private readonly logger = new Logger(KycMediaService.name)
  private readonly encryptionKey: Buffer
  private readonly storageRoot: string

  constructor(
    configService: ConfigService,
    private readonly storage: StorageService
  ) {
    const keyHex = configService.getOrThrow<string>('kyc.mediaEncryptionKey')
    if (!/^[a-f\d]{64}$/i.test(keyHex)) {
      throw new Error(
        'KYC media encryption key must contain 64 hexadecimal characters'
      )
    }
    this.encryptionKey = Buffer.from(keyHex, 'hex')
    this.storageRoot = path.resolve(
      process.cwd(),
      configService.getOrThrow<string>('kyc.privateMediaDir')
    )
  }

  async store(
    userId: string,
    kind: KycMediaKind,
    file: Express.Multer.File
  ): Promise<string> {
    validateUserId(userId)
    validateKycImage(file)
    const id = randomUUID()
    const envelope = encrypt(file, this.encryptionKey)
    if (this.storage.isConfigured) {
      try {
        await this.storage.putObject({
          key: s3Key(userId, kind, id),
          body: envelope,
          contentType: ENCRYPTED_CONTENT_TYPE,
        })
        return `kyc-s3:${userId}:${kind}:${id}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn(`S3 upload failed, storing locally: ${message}`)
      }
    }
    const reference = `kyc-media:${userId}:${kind}:${id}`
    const target = this.resolveReference(reference)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, envelope)
    return reference
  }

  async read(reference: string): Promise<KycMediaContent> {
    if (reference.startsWith('kyc-cloud:')) throw unsupportedCloudReference()
    if (reference.startsWith('kyc-s3:')) return this.readFromS3(reference)
    if (reference.startsWith('kyc-media:')) {
      const encrypted = await fs.readFile(this.resolveReference(reference))
      return decrypt(Buffer.from(encrypted), this.encryptionKey)
    }
    if (reference.startsWith('data:')) return decodeLegacyDataUrl(reference)
    throw new BadRequestException('Nguồn ảnh KYC không được hỗ trợ')
  }

  async remove(reference: string): Promise<void> {
    if (reference.startsWith('kyc-s3:')) {
      await this.removeFromS3(reference)
      return
    }
    if (!reference.startsWith('kyc-media:')) return
    await fs.rm(this.resolveReference(reference), { force: true })
  }

  async asMulterFile(
    reference: string,
    fieldname: string
  ): Promise<Express.Multer.File> {
    const content = await this.read(reference)
    return {
      fieldname,
      originalname: `${fieldname}.${content.mimetype === 'image/png' ? 'png' : 'jpg'}`,
      encoding: '7bit',
      mimetype: content.mimetype,
      size: content.buffer.length,
      buffer: content.buffer,
      destination: '',
      filename: '',
      path: '',
      stream: undefined as unknown as Express.Multer.File['stream'],
    }
  }

  private async readFromS3(reference: string): Promise<KycMediaContent> {
    const key = this.resolveS3Key(reference)
    let envelope: Buffer
    try {
      envelope = await this.storage.getObject(key)
    } catch {
      throw new BadGatewayException('Không thể đọc ảnh KYC đã lưu')
    }
    return decrypt(envelope, this.encryptionKey)
  }

  private async removeFromS3(reference: string): Promise<void> {
    const key = this.resolveS3Key(reference)
    try {
      await this.storage.deleteObject(key)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`S3 delete failed: ${message}`)
    }
  }

  private resolveS3Key(reference: string): string {
    const match = S3_REFERENCE_PATTERN.exec(reference)
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new BadRequestException('Tham chiếu ảnh KYC không hợp lệ')
    }
    return s3Key(match[1], match[2] as KycMediaKind, match[3])
  }

  private resolveReference(reference: string): string {
    const match = MEDIA_REFERENCE_PATTERN.exec(reference)
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new BadRequestException('Tham chiếu ảnh KYC không hợp lệ')
    }
    return path.join(this.storageRoot, match[1], `${match[2]}-${match[3]}.bin`)
  }
}

function s3Key(userId: string, kind: KycMediaKind, id: string): string {
  return `${S3_KYC_PREFIX}/${userId}/${kind}-${id}`
}

function unsupportedCloudReference(): BadRequestException {
  return new BadRequestException('Tham chiếu ảnh KYC không còn được hỗ trợ')
}

function encrypt(file: Express.Multer.File, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(file.buffer), cipher.final()])
  const mimeCode = file.mimetype === 'image/png' ? 2 : 1
  return Buffer.concat([
    Buffer.from([ENVELOPE_VERSION, mimeCode]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ])
}

function decrypt(envelope: Buffer, key: Buffer): KycMediaContent {
  const headerBytes = 2 + IV_BYTES + AUTH_TAG_BYTES
  if (envelope.length <= headerBytes || envelope[0] !== ENVELOPE_VERSION) {
    throw new BadGatewayException('Dữ liệu ảnh KYC đã lưu không hợp lệ')
  }
  const mimetype = readMimeType(envelope[1])
  const iv = envelope.subarray(2, 2 + IV_BYTES)
  const authTag = envelope.subarray(2 + IV_BYTES, headerBytes)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  try {
    return {
      buffer: Buffer.concat([
        decipher.update(envelope.subarray(headerBytes)),
        decipher.final(),
      ]),
      mimetype,
    }
  } catch {
    throw new BadGatewayException('Không thể giải mã ảnh KYC đã lưu')
  }
}

function readMimeType(code: number | undefined): 'image/jpeg' | 'image/png' {
  if (code === 1) return 'image/jpeg'
  if (code === 2) return 'image/png'
  throw new BadGatewayException('Định dạng ảnh KYC đã lưu không hợp lệ')
}

function validateUserId(userId: string): void {
  if (!/^[a-f\d]{24}$/i.test(userId)) {
    throw new BadRequestException('ID người dùng không hợp lệ')
  }
}

function decodeLegacyDataUrl(reference: string): KycMediaContent {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z\d+/=]+)$/.exec(
    reference
  )
  if (!match?.[1] || !match[2]) {
    throw new BadRequestException('Dữ liệu ảnh KYC cũ không hợp lệ')
  }
  return {
    buffer: Buffer.from(match[2], 'base64'),
    mimetype: match[1] as 'image/jpeg' | 'image/png',
  }
}
