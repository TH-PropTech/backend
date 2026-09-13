import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export interface EkycOcrFrontResult {
  idNumber: string
  fullName: string
  dob: string
  gender: string
  nationality: string
  birthplace?: string
  address?: string
}

export interface EkycOcrBackResult {
  success: boolean
  version?: string
  data?: {
    address?: string
    issueDate?: string
    expiryDate?: string
    placeOfBirth?: string
  }
}

export interface EkycBiometricResult {
  verified: boolean
  faceMatch: boolean
  liveness: boolean
  realConfidence: number | null
  motionVariance?: number
  framesProcessed?: number
}

export interface EkycFaceMatchResult {
  verified: boolean
  faceMatch: boolean
  verificationMode: 'face-match-only'
}

export interface EkycFaceOrientationResult {
  success: boolean
  orientation: string | null
  expected: string
  detected_raw?: string
  message?: string
}

type JsonRecord = Record<string, unknown>

@Injectable()
export class EkycProxyService {
  private readonly logger = new Logger(EkycProxyService.name)
  private readonly baseUrl: string
  private readonly faceBaseUrl: string
  private readonly requestTimeoutMs: number

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService
      .getOrThrow<string>('ekyc.serviceUrl')
      .replace(/\/$/, '')
    const configuredFaceUrl = this.configService.get<string>(
      'ekyc.faceServiceUrl'
    )
    this.faceBaseUrl = (
      typeof configuredFaceUrl === 'string' && configuredFaceUrl
        ? configuredFaceUrl
        : this.baseUrl
    ).replace(/\/$/, '')
    this.requestTimeoutMs =
      this.configService.get<number>('ekyc.requestTimeoutMs') ?? 60000
    this.logger.log(
      `EkycProxyService initialized with baseUrl: ${this.baseUrl}`
    )
  }

  async ocrFront(file: Express.Multer.File): Promise<EkycOcrFrontResult> {
    const payload = await this.postForm(
      '/api/ekyc/frontID',
      createFormData('frontID', file)
    )
    return parseOcrFront(payload)
  }

  async ocrBack(file: Express.Multer.File): Promise<EkycOcrBackResult> {
    const payload = await this.postForm(
      '/api/ekyc/backID',
      createFormData('backID', file)
    )
    return parseOcrBack(payload)
  }

  async verifyFace(
    selfie: Express.Multer.File,
    frontCard: Express.Multer.File
  ): Promise<EkycBiometricResult> {
    const formData = new FormData()
    appendFile(formData, 'portraitImages', selfie)
    appendFile(formData, 'frontID', frontCard)
    const payload = await this.postForm('/api/ekyc/liveness', formData)
    return parseBiometric(payload)
  }

  async verifyFaceMatch(
    portraits: readonly Express.Multer.File[],
    frontCard: Express.Multer.File
  ): Promise<EkycFaceMatchResult> {
    const formData = new FormData()
    portraits.forEach(portrait =>
      appendFile(formData, 'portraitImages', portrait)
    )
    appendFile(formData, 'frontID', frontCard)
    const payload = await this.postForm(
      '/api/ekyc-process',
      formData,
      this.faceBaseUrl
    )
    return parseFaceMatch(payload)
  }

  async detectOrientation(
    frame: Express.Multer.File,
    expected: string
  ): Promise<EkycFaceOrientationResult> {
    const formData = createFormData('frame', frame)
    formData.append('expected', expected)
    const payload = await this.postForm(
      '/api/ekyc/detection',
      formData,
      this.faceBaseUrl
    )
    return parseOrientation(payload)
  }

  private async postForm(
    path: string,
    formData: FormData,
    baseUrl = this.baseUrl
  ): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    const targetUrl = `${baseUrl}${path}`

    try {
      this.logger.log(`Proxying eKYC request to: ${targetUrl}`)
      const response = await fetch(targetUrl, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        this.logger.warn(
          `eKYC upstream (${targetUrl}) returned HTTP ${response.status}: ${errorBody}`
        )
        throw new BadGatewayException('Dịch vụ eKYC tạm thời không khả dụng')
      }
      return await response.json()
    } catch (error) {
      if (error instanceof BadGatewayException) throw error
      if (isAbortError(error)) {
        this.logger.error(
          `eKYC request to ${targetUrl} timed out after ${this.requestTimeoutMs}ms`
        )
        throw new GatewayTimeoutException('Dịch vụ eKYC phản hồi quá thời gian')
      }
      this.logger.error(`eKYC upstream request to ${targetUrl} failed:`, error)
      throw new BadGatewayException('Dịch vụ eKYC tạm thời không khả dụng')
    } finally {
      clearTimeout(timeout)
    }
  }
}

function createFormData(
  fieldName: string,
  file: Express.Multer.File
): FormData {
  const formData = new FormData()
  appendFile(formData, fieldName, file)
  return formData
}

function appendFile(
  formData: FormData,
  fieldName: string,
  file: Express.Multer.File
): void {
  const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype })
  formData.append(fieldName, blob, file.originalname)
}

function parseOcrFront(payload: unknown): EkycOcrFrontResult {
  const result = getRootRecord(payload, 'result')
  return {
    idNumber: readString(result.idNumber, 'idNumber'),
    fullName: readString(result.fullName, 'fullName'),
    dob: readString(result.dob, 'dob'),
    gender: readString(result.gender, 'gender'),
    nationality: readString(result.nationality, 'nationality'),
    ...optionalString(result, 'birthplace'),
    ...optionalString(result, 'address'),
  }
}

function parseOcrBack(payload: unknown): EkycOcrBackResult {
  const result = getRootRecord(payload, 'result')
  const data = isRecord(result.data) ? result.data : undefined
  const normalizedData = data
    ? {
        ...renameOptionalString(data, 'address', 'address'),
        ...renameOptionalString(data, 'issue_date', 'issueDate'),
        ...renameOptionalString(data, 'init_date', 'issueDate'),
        ...renameOptionalString(data, 'expiry_date', 'expiryDate'),
        ...renameOptionalString(data, 'place_of_birth', 'placeOfBirth'),
      }
    : undefined
  return {
    success: readBoolean(result.success, 'success'),
    ...optionalString(result, 'version'),
    ...(normalizedData ? { data: normalizedData } : {}),
  }
}

function parseBiometric(payload: unknown): EkycBiometricResult {
  const results = getRootRecord(payload, 'results')
  const faceMatch = readBoolean(results.face_matching, 'face_matching')
  const liveness = readBoolean(results.liveness, 'liveness')
  return {
    verified: faceMatch && liveness && results.success !== false,
    faceMatch,
    liveness,
    realConfidence: readOptionalNumber(results.spoof_score),
    ...optionalNumber(results, 'motion_variance', 'motionVariance'),
    ...optionalNumber(results, 'frames_processed', 'framesProcessed'),
  }
}

function parseFaceMatch(payload: unknown): EkycFaceMatchResult {
  const results = getRootRecord(payload, 'results')
  const faceMatch = readBoolean(results.face_matching, 'face_matching')
  return {
    verified: faceMatch && results.success !== false,
    faceMatch,
    verificationMode: 'face-match-only',
  }
}

function parseOrientation(payload: unknown): EkycFaceOrientationResult {
  const result = isRecord(payload) ? payload : {}
  return {
    success: readBoolean(result.success, 'success'),
    orientation:
      result.orientation === null
        ? null
        : readString(result.orientation, 'orientation'),
    expected: readString(result.expected, 'expected'),
    ...optionalString(result, 'detected_raw'),
    ...optionalString(result, 'message'),
  }
}

function getRootRecord(payload: unknown, key: string): JsonRecord {
  const root = isRecord(payload) ? payload : {}
  const container = isRecord(root.payload) ? root.payload : root
  return readRecord(container[key], key)
}

function readRecord(value: unknown, field: string): JsonRecord {
  if (!isRecord(value)) throw invalidContract(field)
  return value
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw invalidContract(field)
  return value
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalidContract(field)
  return value
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function optionalString(
  record: JsonRecord,
  field: string
): Record<string, string> {
  const value = record[field]
  return typeof value === 'string' ? { [field]: value } : {}
}

function renameOptionalString(
  record: JsonRecord,
  source: string,
  target: string
): Record<string, string> {
  const value = record[source]
  return typeof value === 'string' ? { [target]: value } : {}
}

function optionalNumber(
  record: JsonRecord,
  source: string,
  target: string
): Record<string, number> {
  const value = record[source]
  return typeof value === 'number' && Number.isFinite(value)
    ? { [target]: value }
    : {}
}

function invalidContract(field: string): BadGatewayException {
  return new BadGatewayException(`Phản hồi eKYC không hợp lệ: ${field}`)
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  )
}
