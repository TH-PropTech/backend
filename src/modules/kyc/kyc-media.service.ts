import {
  BadGatewayException,
  BadRequestException,
  Injectable,
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

import { validateKycImage } from './kyc-image.util'

export type KycMediaKind = 'front-card' | 'back-card' | 'selfie'

export interface KycMediaContent {
  readonly buffer: Buffer
  readonly mimetype: 'image/jpeg' | 'image/png'
}

const MEDIA_REFERENCE_PATTERN =
  /^kyc-media:([a-f\d]{24}):(front-card|back-card|selfie):([a-f\d-]{36})$/i
const ENVELOPE_VERSION = 1
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

@Injectable()
export class KycMediaService {
  private readonly encryptionKey: Buffer
  private readonly storageRoot: string

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
  }

  async store(
    userId: string,
    kind: KycMediaKind,
    file: Express.Multer.File
  ): Promise<string> {
    validateUserId(userId)
    validateKycImage(file)
    const reference = `kyc-media:${userId}:${kind}:${randomUUID()}`
    const target = this.resolveReference(reference)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, encrypt(file, this.encryptionKey))
    return reference
  }

  async read(reference: string): Promise<KycMediaContent> {
    if (reference.startsWith('kyc-media:')) {
      const encrypted = await fs.readFile(this.resolveReference(reference))
      return decrypt(Buffer.from(encrypted), this.encryptionKey)
    }
    if (reference.startsWith('data:')) return decodeLegacyDataUrl(reference)
    return fetchLegacyCloudinaryImage(reference)
  }

  async remove(reference: string): Promise<void> {
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

  private resolveReference(reference: string): string {
    const match = MEDIA_REFERENCE_PATTERN.exec(reference)
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new BadRequestException('Tham chiếu ảnh KYC không hợp lệ')
    }
    return path.join(this.storageRoot, match[1], `${match[2]}-${match[3]}.bin`)
  }
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
