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

/** Field order MoMo signs for both IPN bodies and redirect queries. */
const SIGNED_FIELDS = [
  'amount',
  'extraData',
  'message',
  'orderId',
  'orderInfo',
  'orderType',
  'partnerCode',
  'payType',
  'requestId',
  'responseTime',
  'resultCode',
  'transId',
] as const

@Injectable()
export class MomoCallbackVerifier implements GatewayVerifier {
  readonly name = 'momo' as const

  constructor(private readonly configService: ConfigService) {}

  extractTxRef(payload: unknown): string | null {
    const record = asRecord(payload)
    return record ? stringField(record, 'orderId') : null
  }

  verify(
    payload: unknown,
    _kind: GatewayCallbackKind,
    expected: { txRef: string; amount: number }
  ): GatewayVerdict {
    const record = asRecord(payload)
    const signature = record && stringField(record, 'signature')
    const orderId = record && stringField(record, 'orderId')
    const resultCode = record && stringField(record, 'resultCode')
    if (!record || !signature || !orderId || resultCode === null) {
      throw new GatewayVerificationError('invalid-payload')
    }
    const config = this.configService.getOrThrow<PaymentsConfig['momo']>(
      'rentalFlow.payments.momo'
    )
    const rawSignature = [
      `accessKey=${config.accessKey}`,
      ...SIGNED_FIELDS.map(
        field => `${field}=${stringField(record, field) ?? ''}`
      ),
    ].join('&')
    if (
      !sameSignature(
        signature,
        hmacHex('sha256', config.secretKey, rawSignature)
      )
    ) {
      throw new GatewayVerificationError('invalid-signature')
    }
    if (stringField(record, 'partnerCode') !== config.partnerCode) {
      throw new GatewayVerificationError('merchant-mismatch')
    }
    if (orderId !== expected.txRef) {
      throw new GatewayVerificationError('unknown-reference')
    }
    if (parseVndAmount(record.amount) !== expected.amount) {
      throw new GatewayVerificationError('amount-mismatch')
    }
    return {
      txRef: orderId,
      amount: expected.amount,
      succeeded: resultCode === '0',
      providerTransactionId: stringField(record, 'transId'),
    }
  }
}
