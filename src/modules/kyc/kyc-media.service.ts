import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { v2 as cloudinary } from 'cloudinary'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import { validateKycImage } from './kyc-image.util'

export type KycMediaKind = 'front-card' | 'back-card' | 'selfie'

export interface KycMediaContent {
  readonly buffer: Buffer
  readonly mimetype: 'image/jpeg' | 'image/png'
}

const MEDIA_REFERENCE_PATTERN =
  /^kyc-media:([a-f\d]{24}):(front-card|back-card|selfie):([a-f\d-]{36})$/i
const CLOUD_REFERENCE_PATTERN =
  /^kyc-cloud:([a-f\d]{24}):(front-card|back-card|selfie):([a-f\d-]{36})$/i
const CLOUDINARY_KYC_FOLDER = 'kyc'
const CLOUDINARY_READ_TIMEOUT_MS = 15_000
const ENVELOPE_VERSION = 1
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

@Injectable()
export class KycMediaService {
  private readonly logger = new Logger(KycMediaService.name)
  private readonly encryptionKey: Buffer
  private readonly storageRoot: string
  private readonly cloudinaryConfig: CloudinaryCredentials | null

  constructor(configService: ConfigService) {
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
    const cloudName = configService.get<string>('cloudinary.cloudName')
    const apiKey = configService.get<string>('cloudinary.apiKey')
    const apiSecret = configService.get<string>('cloudinary.apiSecret')
    this.cloudinaryConfig =
      cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null
  }

  async store(
    userId: string,
    kind: KycMediaKind,
    file: Express.Multer.File
  ): Promise<string> {
    validateUserId(userId)
    validateKycImage(file)
    const id = randomUUID()
    if (this.cloudinaryConfig) {
      try {
        await this.uploadToCloudinary(userId, kind, id, file)
        return `kyc-cloud:${userId}:${kind}:${id}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn(
          `Cloudinary upload failed, storing locally: ${message}`
        )
      }
    }
    const reference = `kyc-media:${userId}:${kind}:${id}`
    const target = this.resolveReference(reference)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, encrypt(file, this.encryptionKey))
    return reference
  }

  async read(reference: string): Promise<KycMediaContent> {
    if (reference.startsWith('kyc-cloud:')) {
      return this.readFromCloudinary(reference)
    }
    if (reference.startsWith('kyc-media:')) {
      const encrypted = await fs.readFile(this.resolveReference(reference))
      return decrypt(Buffer.from(encrypted), this.encryptionKey)
    }
    if (reference.startsWith('data:')) return decodeLegacyDataUrl(reference)
    return fetchLegacyCloudinaryImage(reference)
  }

  async remove(reference: string): Promise<void> {
    if (reference.startsWith('kyc-cloud:')) {
      await this.removeFromCloudinary(reference)
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

  /** Private (authenticated) upload: the image has no public URL and needs a signed one to be read. */
  private async uploadToCloudinary(
    userId: string,
    kind: KycMediaKind,
    id: string,
    file: Express.Multer.File
  ): Promise<void> {
    this.configureCloudinary()
    await new Promise<void>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: cloudinaryPublicId(userId, kind, id),
          type: 'authenticated',
          resource_type: 'image',
          overwrite: false,
        },
        (error, result) => {
          if (error || !result) {
            reject(new Error(error?.message ?? 'empty upload result'))
          } else {
            resolve()
          }
        }
      )
      stream.end(file.buffer)
    })
  }

  private async readFromCloudinary(
    reference: string
  ): Promise<KycMediaContent> {
    this.configureCloudinary()
    const url = cloudinary.url(this.resolveCloudPublicId(reference), {
      resource_type: 'image',
      type: 'authenticated',
      sign_url: true,
      secure: true,
    })
    let response: Response
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(CLOUDINARY_READ_TIMEOUT_MS),
      })
    } catch {
      throw new BadGatewayException('Không thể đọc ảnh KYC đã lưu')
    }
    if (!response.ok) {
      throw new BadGatewayException('Không thể đọc ảnh KYC đã lưu')
    }
    const mimetype = response.headers.get('content-type')?.split(';')[0]
    if (mimetype !== 'image/jpeg' && mimetype !== 'image/png') {
      throw new BadGatewayException('Định dạng ảnh KYC đã lưu không hợp lệ')
    }
    return { buffer: Buffer.from(await response.arrayBuffer()), mimetype }
  }

  private async removeFromCloudinary(reference: string): Promise<void> {
    this.configureCloudinary()
    try {
      await cloudinary.uploader.destroy(this.resolveCloudPublicId(reference), {
        type: 'authenticated',
        resource_type: 'image',
        invalidate: true,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Cloudinary delete failed: ${message}`)
    }
  }

  private configureCloudinary(): void {
    if (!this.cloudinaryConfig) {
      throw new BadGatewayException('Chưa cấu hình lưu trữ ảnh KYC trên cloud')
    }
    cloudinary.config({
      cloud_name: this.cloudinaryConfig.cloudName,
      api_key: this.cloudinaryConfig.apiKey,
      api_secret: this.cloudinaryConfig.apiSecret,
      secure: true,
    })
  }

  private resolveCloudPublicId(reference: string): string {
    const match = CLOUD_REFERENCE_PATTERN.exec(reference)
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new BadRequestException('Tham chiếu ảnh KYC không hợp lệ')
    }
    return cloudinaryPublicId(match[1], match[2] as KycMediaKind, match[3])
  }

  private resolveReference(reference: string): string {
    const match = MEDIA_REFERENCE_PATTERN.exec(reference)
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new BadRequestException('Tham chiếu ảnh KYC không hợp lệ')
    }
    return path.join(this.storageRoot, match[1], `${match[2]}-${match[3]}.bin`)
  }
}

interface CloudinaryCredentials {
  readonly cloudName: string
  readonly apiKey: string
  readonly apiSecret: string
}

function cloudinaryPublicId(
  userId: string,
  kind: KycMediaKind,
  id: string
): string {
  return `${CLOUDINARY_KYC_FOLDER}/${userId}/${kind}-${id}`
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

async function fetchLegacyCloudinaryImage(
  reference: string
): Promise<KycMediaContent> {
  const url = new URL(reference)
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') {
    throw new BadRequestException('Nguồn ảnh KYC cũ không được phép')
  }
  const response = await fetch(url)
  if (!response.ok) throw new BadGatewayException('Không thể đọc ảnh KYC cũ')
  const mimetype = response.headers.get('content-type')?.split(';')[0]
  if (mimetype !== 'image/jpeg' && mimetype !== 'image/png') {
    throw new BadGatewayException('Nguồn ảnh KYC cũ không hợp lệ')
  }
  return { buffer: Buffer.from(await response.arrayBuffer()), mimetype }
}
