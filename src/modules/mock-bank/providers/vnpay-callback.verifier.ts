import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { PaymentsConfig } from '../../../config/configuration'
import {
  GatewayVerificationError,
  type GatewayCallbackKind,
  type GatewayVerdict,
  type GatewayVerifier,
} from './payment-provider.port'
import {
  asRecord,
  hmacHex,
  parseVndAmount,
  sameSignature,
  stringField,
} from './gateway.util'

/**
 * VNPAY signing input: `vnp_*` fields (minus the hash fields) sorted by ASCII
 * key, each value URL-encoded with spaces as `+`, joined by `&`. Used for
 * both outgoing payment URLs and incoming return/IPN verification.
 */
export function vnpayCanonicalQuery(params: Record<string, unknown>): string {
  return Object.keys(params)
    .filter(
      key =>
        key.startsWith('vnp_') &&
        key !== 'vnp_SecureHash' &&
        key !== 'vnp_SecureHashType'
    )
    .map(key => [key, stringField(params, key)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%20/g, '+')}`
    )
    .join('&')
}

@Injectable()
export class VnpayCallbackVerifier implements GatewayVerifier {
  readonly name = 'vnpay' as const

  constructor(private readonly configService: ConfigService) {}

  extractTxRef(payload: unknown): string | null {
    const query = asRecord(payload)
    return query ? stringField(query, 'vnp_TxnRef') : null
  }

  /** IPN and browser return share one format and one signature scheme. */
  verify(
    payload: unknown,
    _kind: GatewayCallbackKind,
    expected: { txRef: string; amount: number }
  ): GatewayVerdict {
    const query = asRecord(payload)
    const signature = query && stringField(query, 'vnp_SecureHash')
    const txRef = query && stringField(query, 'vnp_TxnRef')
    const amountMinor = query && stringField(query, 'vnp_Amount')
    const responseCode = query && stringField(query, 'vnp_ResponseCode')
    if (!query || !signature || !txRef || !amountMinor || !responseCode) {
      throw new GatewayVerificationError('invalid-payload')
    }
    const config = this.configService.getOrThrow<PaymentsConfig['vnpay']>(
      'rentalFlow.payments.vnpay'
    )
    const expectedSignature = hmacHex(
      'sha512',
      config.hashSecret,
      vnpayCanonicalQuery(query)
    )
    if (!sameSignature(signature, expectedSignature)) {
      throw new GatewayVerificationError('invalid-signature')
    }
    if (stringField(query, 'vnp_TmnCode') !== config.tmnCode) {
      throw new GatewayVerificationError('merchant-mismatch')
    }
    if (txRef !== expected.txRef) {
      throw new GatewayVerificationError('unknown-reference')
    }
    const minor = parseVndAmount(amountMinor)
    if (minor === null || minor !== expected.amount * 100) {
      throw new GatewayVerificationError('amount-mismatch')
    }
    return {
      txRef,
      amount: expected.amount,
      succeeded:
        responseCode === '00' &&
        stringField(query, 'vnp_TransactionStatus') === '00',
      providerTransactionId: stringField(query, 'vnp_TransactionNo'),
    }
  }
}
