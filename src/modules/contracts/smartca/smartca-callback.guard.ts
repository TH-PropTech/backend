import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, timingSafeEqual } from 'node:crypto'

export type SmartCaCallbackPayload = {
  transactionId: string
  status: 'signed' | 'rejected'
  artifactHash: string
  certificateSerial?: string
  certificateSubject?: string
  certificateIssuer?: string
  signatureHash?: string
  signatureAlgorithm?: string
  signatureValueRef?: string
  signedAt?: string
}

type SmartCaCallbackRequest = {
  body?: unknown
  headers: Record<string, string | string[] | undefined>
}

const CALLBACK_WINDOW_MS = 5 * 60 * 1000

export function signSmartCaCallback(
  payload: SmartCaCallbackPayload,
  timestamp: string,
  nonce: string,
  secret: string
): string {
  return createHmac('sha256', secret)
    .update(canonicalSmartCaCallback(payload, timestamp, nonce))
    .digest('hex')
}

function canonicalSmartCaCallback(
  payload: SmartCaCallbackPayload,
  timestamp: string,
  nonce: string
): string {
  return [
    timestamp,
    nonce,
    payload.transactionId,
    payload.status,
    payload.artifactHash,
    payload.certificateSerial ?? '',
    payload.certificateSubject ?? '',
    payload.certificateIssuer ?? '',
    payload.signatureHash ?? '',
    payload.signatureAlgorithm ?? '',
    payload.signatureValueRef ?? '',
    payload.signedAt ?? '',
  ].join('.')
}

function headerValue(
  headers: SmartCaCallbackRequest['headers'],
  name: string
): string {
  const value = headers[name]
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function isCallbackPayload(value: unknown): value is SmartCaCallbackPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return (
    typeof payload.transactionId === 'string' &&
    payload.transactionId.length > 0 &&
    (payload.status === 'signed' || payload.status === 'rejected') &&
    typeof payload.artifactHash === 'string' &&
    payload.artifactHash.length > 0
  )
}

@Injectable()
export class SmartCaCallbackGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SmartCaCallbackRequest>()
    const secret = this.configService.get<string>('smartCA.callbackSecret')
    if (!secret) {
      throw new UnauthorizedException('SMARTCA_CALLBACK_NOT_CONFIGURED')
    }

    const payload = request.body
    const timestamp = headerValue(request.headers, 'x-smartca-timestamp')
    const nonce = headerValue(request.headers, 'x-smartca-nonce')
    const receivedSignature = headerValue(
      request.headers,
      'x-smartca-signature'
    )
    const timestampMs = Number(timestamp)
    if (
      !isCallbackPayload(payload) ||
      !nonce ||
      !receivedSignature ||
      !Number.isSafeInteger(timestampMs) ||
      Math.abs(Date.now() - timestampMs) > CALLBACK_WINDOW_MS
    ) {
      throw new UnauthorizedException('SMARTCA_CALLBACK_INVALID')
    }

    const expectedSignature = signSmartCaCallback(
      payload,
      timestamp,
      nonce,
      secret
    )
    const received = Buffer.from(receivedSignature, 'utf8')
    const expected = Buffer.from(expectedSignature, 'utf8')
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException('SMARTCA_CALLBACK_SIGNATURE_INVALID')
    }
    return true
  }
}
