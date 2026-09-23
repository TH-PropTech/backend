import {
  Injectable,
  ServiceUnavailableException,
  BadGatewayException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export type SmartCaSigningRequest = {
  transactionId: string
  artifactHash: string
  signerId: string
  signerRole: 'tenant' | 'landlord'
}

export type SmartCaSigningResponse = {
  transactionId: string
  status: 'pending' | 'signed' | 'rejected'
  confirmationUrl?: string
  certificateSerial?: string
  certificateSubject?: string
  certificateIssuer?: string
  signatureHash?: string
  signatureAlgorithm?: string
  signatureValueRef?: string
  artifactHash?: string
  signedAt?: string
}

type SmartCaConfig = {
  apiUrl?: string
  spId?: string
  spPassword?: string
  mobileCode?: string
  signV2Path?: string
  statusPathTmpl?: string
}

@Injectable()
export class SmartCaProvider {
  constructor(private readonly configService: ConfigService) {}

  async requestSignature(
    input: SmartCaSigningRequest
  ): Promise<SmartCaSigningResponse> {
    const config = this.configService.get<SmartCaConfig>('smartCA')
    if (
      !config?.apiUrl ||
      !config.spId ||
      !config.spPassword ||
      !config.signV2Path
    ) {
      throw new ServiceUnavailableException('SMARTCA_NOT_CONFIGURED')
    }

    let response: Response
    try {
      response = await fetch(`${config.apiUrl}${config.signV2Path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sp_id: config.spId,
          sp_password: config.spPassword,
          mobile_code: config.mobileCode,
          user_id: input.signerId,
          transaction_id: input.transactionId,
          document_hash: input.artifactHash,
          signer_role: input.signerRole,
        }),
      })
    } catch {
      throw new ServiceUnavailableException('SMARTCA_PROVIDER_UNAVAILABLE')
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new BadGatewayException('SMARTCA_RESPONSE_INVALID')
    }
    if (!response.ok || !payload || typeof payload !== 'object') {
      throw new BadGatewayException('SMARTCA_REQUEST_FAILED')
    }

    return this.normalizeResponse(payload, input.transactionId)
  }

  async getSignatureStatus(
    providerTransactionId: string
  ): Promise<SmartCaSigningResponse> {
    const config = this.configService.get<SmartCaConfig>('smartCA')
    if (!config?.apiUrl || !config.statusPathTmpl) {
      throw new ServiceUnavailableException('SMARTCA_NOT_CONFIGURED')
    }

    let response: Response
    try {
      response = await fetch(
        `${config.apiUrl}${config.statusPathTmpl.replace(
          '{transactionId}',
          encodeURIComponent(providerTransactionId)
        )}`,
        { method: 'GET', headers: { accept: 'application/json' } }
      )
    } catch {
      throw new ServiceUnavailableException('SMARTCA_PROVIDER_UNAVAILABLE')
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new BadGatewayException('SMARTCA_RESPONSE_INVALID')
    }
    if (!response.ok || !payload || typeof payload !== 'object') {
      throw new BadGatewayException('SMARTCA_REQUEST_FAILED')
    }
    return this.normalizeResponse(payload, providerTransactionId)
  }

  private normalizeResponse(
    payload: object,
    fallbackTransactionId: string
  ): SmartCaSigningResponse {
    const data = payload as Record<string, unknown>
    const transactionId =
      typeof data.transaction_id === 'string'
        ? data.transaction_id
        : typeof data.transactionId === 'string'
          ? data.transactionId
          : fallbackTransactionId
    const rawStatusValue = data.status ?? data.result
    const rawStatus =
      typeof rawStatusValue === 'string'
        ? rawStatusValue.toLowerCase()
        : 'pending'
    const status: SmartCaSigningResponse['status'] =
      rawStatus.includes('reject') || rawStatus.includes('fail')
        ? 'rejected'
        : rawStatus.includes('sign') || rawStatus.includes('success')
          ? 'signed'
          : 'pending'

    if (status === 'signed' && typeof data.certificate_serial !== 'string') {
      throw new BadGatewayException('SMARTCA_CERTIFICATE_INVALID')
    }

    return {
      transactionId,
      status,
      ...(typeof data.confirmation_url === 'string'
        ? { confirmationUrl: data.confirmation_url }
        : {}),
      ...(typeof data.certificate_serial === 'string'
        ? { certificateSerial: data.certificate_serial }
        : {}),
      ...(typeof data.certificate_subject === 'string'
        ? { certificateSubject: data.certificate_subject }
        : {}),
      ...(typeof data.certificate_issuer === 'string'
        ? { certificateIssuer: data.certificate_issuer }
        : {}),
      ...(typeof data.signature_hash === 'string'
        ? { signatureHash: data.signature_hash }
        : {}),
      ...(typeof data.signature_algorithm === 'string'
        ? { signatureAlgorithm: data.signature_algorithm }
        : {}),
      ...(typeof data.signature_value_ref === 'string'
        ? { signatureValueRef: data.signature_value_ref }
        : {}),
      ...(typeof data.artifact_hash === 'string'
        ? { artifactHash: data.artifact_hash }
        : {}),
      ...(typeof data.signed_at === 'string'
        ? { signedAt: data.signed_at }
        : {}),
    }
  }
}
