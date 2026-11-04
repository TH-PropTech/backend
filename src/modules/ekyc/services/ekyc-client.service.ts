import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  FACE_POSES,
  type EkycFaceResult,
  type EkycOcrBackResult,
  type EkycOcrFrontResult,
  type EkycPoseResult,
  type FacePose,
} from '../interfaces/ekyc-ocr.interface'
import {
  digitsOnly,
  isRecord,
  normalizeDate,
  normalizeGender,
  readText,
  type JsonRecord,
} from '../utils/ekyc-normalize.util'

const UPSTREAM_UNAVAILABLE = 'Dịch vụ xác thực eKYC tạm thời không khả dụng'
const FRONT_UNREADABLE = 'Không đọc được thông tin mặt trước thẻ'

/**
 * HTTP adapter for the Python eKYC service (OCR + face verification). Images go
 * only to our own service; the face embedding it returns is dropped here.
 */
@Injectable()
export class EkycClient {
  private readonly logger = new Logger(EkycClient.name)
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(configService: ConfigService) {
    this.baseUrl = configService
      .getOrThrow<string>('ekyc.serviceUrl')
      .replace(/\/+$/, '')
    this.timeoutMs = configService.getOrThrow<number>('ekyc.requestTimeoutMs')
  }

  async ocrFront(file: Express.Multer.File): Promise<EkycOcrFrontResult> {
    const form = new FormData()
    appendImage(form, 'frontID', file)
    const fields = await this.post('/api/ocr/front', form)

    // Partial reads are returned as-is: the user corrects the form, so a field
    // that failed validation is left empty instead of rejecting the whole card.
    const idNumber = digitsOnly(readText(fields, 'idNumber'))
    const birthplace = readText(fields, 'birthplace')
    const address = readText(fields, 'address')
    return {
      idNumber: /^(\d{9}|\d{12})$/.test(idNumber) ? idNumber : '',
      fullName: readText(fields, 'fullName'),
      dob: normalizeDate(readText(fields, 'dob')),
      gender: normalizeGender(readText(fields, 'gender')),
      nationality: readNationality(fields),
      ...(birthplace ? { birthplace } : {}),
      ...(address ? { address } : {}),
    }
  }

  async ocrBack(file: Express.Multer.File): Promise<EkycOcrBackResult> {
    const form = new FormData()
    appendImage(form, 'backID', file)
    const fields = await this.post('/api/ocr/back', form)

    const version = readText(fields, 'version')
    const issueDate = normalizeDate(readText(fields, 'issueDate'))
    // Old (9-digit) cards only expose the issue date; ignore anything else.
    const isOldCard = version === 'old'
    const expiryDate = isOldCard
      ? ''
      : normalizeDate(readText(fields, 'expiryDate'))
    const placeOfBirth = isOldCard ? '' : readText(fields, 'placeOfBirth')
    const address = isOldCard ? '' : readText(fields, 'address')
    return {
      success: true,
      ...(version ? { version } : {}),
      data: {
        ...(address ? { address } : {}),
        ...(issueDate ? { issueDate } : {}),
        ...(expiryDate ? { expiryDate } : {}),
        ...(placeOfBirth ? { placeOfBirth } : {}),
      },
    }
  }

  async verifyFace(
    selfie: Express.Multer.File,
    frontCard: Express.Multer.File
  ): Promise<EkycFaceResult> {
    const form = new FormData()
    appendImage(form, 'selfie', selfie)
    appendImage(form, 'frontID', frontCard)
    const result = await this.post('/api/face/verify', form)

    const { liveness, spoofScore, match, distance, threshold } = result
    if (
      typeof liveness !== 'boolean' ||
      typeof match !== 'boolean' ||
      !isFiniteNumber(spoofScore) ||
      !isFiniteNumber(distance) ||
      !isFiniteNumber(threshold)
    ) {
      this.logger.warn('eKYC face payload failed shape guards')
      throw new BadGatewayException(UPSTREAM_UNAVAILABLE)
    }
    return { liveness, spoofScore, match, distance, threshold }
  }

  /** One step of the head-pose challenge: does this frame show the expected direction? */
  async checkPose(
    image: Express.Multer.File,
    expected: FacePose
  ): Promise<EkycPoseResult> {
    const form = new FormData()
    appendImage(form, 'image', image)
    form.append('expected', expected)
    const result = await this.post('/api/face/pose', form)

    const { faceFound, matches, pose } = result
    if (
      typeof faceFound !== 'boolean' ||
      typeof matches !== 'boolean' ||
      (pose !== null && !FACE_POSES.includes(pose as FacePose))
    ) {
      this.logger.warn('eKYC pose payload failed shape guards')
      throw new BadGatewayException(UPSTREAM_UNAVAILABLE)
    }
    return {
      faceFound,
      matches,
      pose: pose as FacePose | null,
    }
  }

  /** Posts the form and returns the `result` object, mapping failures per design D1. */
  private async post(path: string, form: FormData): Promise<JsonRecord> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        this.logger.warn(`eKYC ${path} timed out after ${this.timeoutMs}ms`)
        throw new GatewayTimeoutException(UPSTREAM_UNAVAILABLE)
      }
      this.logger.warn(`eKYC ${path} request failed: ${describe(error)}`)
      throw new BadGatewayException(UPSTREAM_UNAVAILABLE)
    }

    const body = await readJson(response)
    if (response.status === 422) {
      const message = isRecord(body) ? readText(body, 'error') : ''
      throw new UnprocessableEntityException(message || FRONT_UNREADABLE)
    }
    if (response.status === 400) {
      this.logger.error(`eKYC ${path} rejected our request: HTTP 400`)
      throw new InternalServerErrorException()
    }
    if (!response.ok) {
      this.logger.warn(`eKYC ${path} returned HTTP ${response.status}`)
      throw new BadGatewayException(UPSTREAM_UNAVAILABLE)
    }
    if (!isRecord(body) || !isRecord(body.result)) {
      this.logger.warn(`eKYC ${path} returned a malformed payload`)
      throw new BadGatewayException(UPSTREAM_UNAVAILABLE)
    }
    return body.result
  }
}

/** A misread box ("%", "1") must not reach the form; fall back to the card's usual value. */
function readNationality(fields: JsonRecord): string {
  const value = readText(fields, 'nationality')
  return /^\p{L}[\p{L} ]{2,}$/u.test(value) ? value : 'Việt Nam'
}

function appendImage(
  form: FormData,
  field: string,
  file: Express.Multer.File
): void {
  form.append(
    field,
    new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
    file.originalname || `${field}.jpg`
  )
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
