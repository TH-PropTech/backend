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
}

type SmartCaConfig = {
  apiUrl?: string
  spId?: string
  spPassword?: string
  mobileCode?: string
  signV2Path?: string
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

    const data = payload as Record<string, unknown>
    const transactionId =
      typeof data.transaction_id === 'string'
        ? data.transaction_id
        : typeof data.transactionId === 'string'
          ? data.transactionId
          : input.transactionId
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
    }
  }
}
