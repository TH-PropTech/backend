import { randomUUID } from 'node:crypto'
import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export type SmartCaCertificate = {
  serialNumber: string
  status?: string
  serviceType?: string
  subject?: string
  issuer?: string
  validFrom?: string
  validTo?: string
  isValid: boolean
}

export type SmartCaSigningRequest = {
  transactionId: string
  artifactHash: string
  signerCccd: string
  certificateSerial: string
  documentId: string
}

export type SmartCaSignResult = {
  transactionId: string
  transactionCode?: string
}

export type SmartCaSignature = {
  documentId: string
  signatureValue: string
  signedAt: string | null
}

export type SmartCaStatusResult = {
  transactionId: string
  status: 'pending' | 'signed' | 'rejected'
  signature?: SmartCaSignature
}

type SmartCaConfig = {
  apiUrl?: string
  spId?: string
  spPassword?: string
  certPath?: string
  signPath?: string
  statusPathTmpl?: string
}

type SmartCaEnvelope = {
  statusCode: number
  message: string
  data: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(
  value: unknown,
  alternative?: unknown
): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof alternative === 'string' && alternative.trim()) return alternative
  return undefined
}

@Injectable()
export class SmartCaProvider {
  constructor(private readonly configService: ConfigService) {}

  async listCertificates(signerCccd: string): Promise<SmartCaCertificate[]> {
    const config = this.requireConfig('certPath')
    const envelope = await this.post(`${config.apiUrl}${config.certPath}`, {
      sp_id: config.spId,
      sp_password: config.spPassword,
      user_id: signerCccd,
      // Gateway v1 bắt buộc transaction_id cho cả get_certificate (thiếu → 400 missing_parameter_transaction_id).
      transaction_id: `cert-${randomUUID()}`,
    })
    const certificates = envelope.data.user_certificates
    if (!Array.isArray(certificates)) this.invalidResponse()

    return certificates.map(certificate => this.parseCertificate(certificate))
  }

  /**
   * VNPT SmartCA v1 (§3.3): gửi yêu cầu ký, CA đẩy thông báo xuống app của
   * thuê bao. Không có mật khẩu/OTP người ký; kết quả lấy qua status/webhook.
   */
  async requestSignature(
    input: SmartCaSigningRequest
  ): Promise<SmartCaSignResult> {
    const config = this.requireConfig('signPath')
    const envelope = await this.post(`${config.apiUrl}${config.signPath}`, {
      sp_id: config.spId,
      sp_password: config.spPassword,
      user_id: input.signerCccd,
      transaction_id: input.transactionId,
      serial_number: input.certificateSerial,
      sign_files: [
        {
          doc_id: input.documentId,
          file_type: 'pdf',
          sign_type: 'hash',
          data_to_be_signed: input.artifactHash,
        },
      ],
    })
    const transactionId = optionalString(envelope.data.transaction_id)
    if (!transactionId) this.invalidResponse()

    const transactionCode = optionalString(envelope.data.tran_code)
    return {
      transactionId,
      ...(transactionCode ? { transactionCode } : {}),
    }
  }

  async getSignatureStatus(
    providerTransactionId: string,
    documentId: string
  ): Promise<SmartCaStatusResult> {
    const config = this.requireConfig('statusPathTmpl')
    const path = config.statusPathTmpl.replace(
      '{transactionId}',
      encodeURIComponent(providerTransactionId)
    )
    const envelope = await this.post(`${config.apiUrl}${path}`, {})
    const transactionId = optionalString(envelope.data.transaction_id)
    const signatures = envelope.data.signatures
    if (transactionId !== providerTransactionId || !Array.isArray(signatures)) {
      this.invalidResponse()
    }

    const signatureEntries: unknown[] = signatures
    const matching = signatureEntries.find(
      value => isRecord(value) && value.doc_id === documentId
    )
    if (matching) {
      return {
        transactionId,
        status: 'signed',
        signature: this.parseSignature(matching),
      }
    }
    if (signatureEntries.length > 0) this.invalidResponse()

    const rawStatus = optionalString(envelope.data.status)?.toLowerCase()
    const message = envelope.message.toLowerCase()
    const rejected =
      rawStatus === 'rejected' ||
      rawStatus === 'failed' ||
      message.includes('reject') ||
      message.includes('fail')
    return { transactionId, status: rejected ? 'rejected' : 'pending' }
  }

  private requireConfig<
    TPath extends 'certPath' | 'signPath' | 'statusPathTmpl',
  >(path: TPath): SmartCaConfig & Required<Pick<SmartCaConfig, TPath>> {
    const config = this.configService.get<SmartCaConfig>('smartCA')
    if (
      !config?.apiUrl ||
      !config.spId ||
      !config.spPassword ||
      !config[path]
    ) {
      throw new ServiceUnavailableException('SMARTCA_NOT_CONFIGURED')
    }
    return config as SmartCaConfig & Required<Pick<SmartCaConfig, TPath>>
  }

  private async post(
    url: string,
    body: Record<string, unknown>
  ): Promise<SmartCaEnvelope> {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      throw new ServiceUnavailableException('SMARTCA_PROVIDER_UNAVAILABLE')
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new BadGatewayException('SMARTCA_PROVIDER_RESPONSE_INVALID')
    }
    if (!response.ok) throw new BadGatewayException('SMARTCA_REQUEST_FAILED')

    const envelope = this.parseEnvelope(payload)
    if (envelope.statusCode !== 200) {
      // 65000: gói dịch vụ của người ký hết hạn / hết lượt ký (cần mua lượt ký trong app SmartCA).
      if (envelope.statusCode === 65000) {
        throw new UnprocessableEntityException('SMARTCA_SERVICE_PACK_EXPIRED')
      }
      if ([400, 401, 403, 422].includes(envelope.statusCode)) {
        throw new UnprocessableEntityException(
          'SMARTCA_CREDENTIAL_OR_REQUEST_REJECTED'
        )
      }
      throw new BadGatewayException('SMARTCA_REQUEST_FAILED')
    }
    return envelope
  }

  private parseEnvelope(payload: unknown): SmartCaEnvelope {
    if (!isRecord(payload)) this.invalidResponse()
    const rawStatusCode = payload.status_code
    const statusCode =
      typeof rawStatusCode === 'number'
        ? rawStatusCode
        : typeof rawStatusCode === 'string'
          ? Number(rawStatusCode)
          : Number.NaN
    if (!Number.isFinite(statusCode) || typeof payload.message !== 'string') {
      this.invalidResponse()
    }
    if (statusCode === 200 && !isRecord(payload.data)) this.invalidResponse()
    return {
      statusCode,
      message: payload.message,
      data: isRecord(payload.data) ? payload.data : {},
    }
  }

  private parseCertificate(payload: unknown): SmartCaCertificate {
    if (!isRecord(payload)) this.invalidResponse()
    const serialNumber = optionalString(payload.serial, payload.serial_number)
    if (!serialNumber) this.invalidResponse()

    const status = optionalString(payload.cert_status, payload.status)
    const serviceType = optionalString(payload.service_type)
    const subject = optionalString(payload.cert_subject, payload.subject)
    const issuer = optionalString(payload.cert_issuer, payload.issuer)
    const validFrom = optionalString(
      payload.cert_valid_from,
      payload.valid_from
    )
    const validTo = optionalString(payload.cert_valid_to, payload.valid_to)
    const now = Date.now()
    const startsAt = validFrom ? Date.parse(validFrom) : Number.NaN
    const endsAt = validTo ? Date.parse(validTo) : Number.NaN
    // Production trả cert_status là nhãn tiếng Việt ("Đang hoạt động") và mã máy đọc ở
    // cert_status_code ("VALID"); cổng test/mock trả mã ngay trong cert_status.
    const statusCode = optionalString(payload.cert_status_code)
    const isActiveCode = (value: string | undefined): boolean => {
      const normalized = value?.toUpperCase()
      return (
        normalized === 'ACTIVE' || normalized === 'VALID' || normalized === '1'
      )
    }
    const activeStatus = isActiveCode(statusCode) || isActiveCode(status)
    const validWindow =
      Number.isFinite(startsAt) && Number.isFinite(endsAt)
        ? startsAt <= now && endsAt > now
        : false

    return {
      serialNumber,
      ...(status ? { status } : {}),
      ...(serviceType ? { serviceType } : {}),
      ...(subject ? { subject } : {}),
      ...(issuer ? { issuer } : {}),
      ...(validFrom ? { validFrom } : {}),
      ...(validTo ? { validTo } : {}),
      isValid: activeStatus && validWindow,
    }
  }

  private parseSignature(payload: unknown): SmartCaSignature {
    if (!isRecord(payload)) this.invalidResponse()
    const documentId = optionalString(payload.doc_id)
    const signatureValue = optionalString(payload.signature_value)
    const timestamp = payload.timestamp_signature
    if (
      !documentId ||
      !signatureValue ||
      (timestamp !== null &&
        timestamp !== undefined &&
        typeof timestamp !== 'string')
    ) {
      this.invalidResponse()
    }
    return {
      documentId,
      signatureValue,
      signedAt: typeof timestamp === 'string' ? timestamp : null,
    }
  }

  private invalidResponse(): never {
    throw new BadGatewayException('SMARTCA_PROVIDER_RESPONSE_INVALID')
  }
}
