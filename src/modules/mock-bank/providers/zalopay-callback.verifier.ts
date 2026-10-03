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

/** Fields ZaloPay signs (key2) on the browser redirect, in order. */
const RETURN_CHECKSUM_FIELDS = [
  'appid',
  'apptransid',
  'pmcid',
  'bankcode',
  'amount',
  'discountamount',
  'status',
] as const

@Injectable()
export class ZalopayCallbackVerifier implements GatewayVerifier {
  readonly name = 'zalopay' as const

  constructor(private readonly configService: ConfigService) {}

  extractTxRef(payload: unknown, kind: GatewayCallbackKind): string | null {
    const record = asRecord(payload)
    if (!record) return null
    if (kind === 'return') return stringField(record, 'apptransid')
    const data = parseData(record)
    return data ? stringField(data, 'app_trans_id') : null
  }

  verify(
    payload: unknown,
    kind: GatewayCallbackKind,
    expected: { txRef: string; amount: number }
  ): GatewayVerdict {
    const record = asRecord(payload)
    if (!record) throw new GatewayVerificationError('invalid-payload')
    const config = this.configService.getOrThrow<PaymentsConfig['zalopay']>(
      'rentalFlow.payments.zalopay'
    )
    return kind === 'notify'
      ? this.verifyCallback(record, config, expected)
      : this.verifyReturn(record, config, expected)
  }

  /** Server callback `{data, mac, type}`; ZaloPay only sends it on success. */
  private verifyCallback(
    record: Record<string, unknown>,
    config: PaymentsConfig['zalopay'],
    expected: { txRef: string; amount: number }
  ): GatewayVerdict {
    const rawData = stringField(record, 'data')
    const mac = stringField(record, 'mac')
    if (!rawData || !mac) throw new GatewayVerificationError('invalid-payload')
    if (!sameSignature(mac, hmacHex('sha256', config.key2, rawData))) {
      throw new GatewayVerificationError('invalid-signature')
    }
    const data = parseData(record)
    if (!data) throw new GatewayVerificationError('invalid-payload')
    return this.matchOrder(
      {
        appId: stringField(data, 'app_id'),
        txRef: stringField(data, 'app_trans_id'),
        amount: data.amount,
      },
      config,
      expected,
      true,
      stringField(data, 'zp_trans_id')
    )
  }

  private verifyReturn(
    record: Record<string, unknown>,
    config: PaymentsConfig['zalopay'],
    expected: { txRef: string; amount: number }
  ): GatewayVerdict {
    const checksum = stringField(record, 'checksum')
    const values = RETURN_CHECKSUM_FIELDS.map(field =>
      stringField(record, field)
    )
    if (!checksum || values.some(value => value === null)) {
      throw new GatewayVerificationError('invalid-payload')
    }
    const expectedChecksum = hmacHex('sha256', config.key2, values.join('|'))
    if (!sameSignature(checksum, expectedChecksum)) {
      throw new GatewayVerificationError('invalid-signature')
    }
    return this.matchOrder(
      {
        appId: stringField(record, 'appid'),
        txRef: stringField(record, 'apptransid'),
        amount: record.amount,
      },
      config,
      expected,
      stringField(record, 'status') === '1',
      null
    )
  }

  private matchOrder(
    order: { appId: string | null; txRef: string | null; amount: unknown },
    config: PaymentsConfig['zalopay'],
    expected: { txRef: string; amount: number },
    succeeded: boolean,
    providerTransactionId: string | null
  ): GatewayVerdict {
    if (order.appId !== config.appId) {
      throw new GatewayVerificationError('merchant-mismatch')
    }
    if (order.txRef !== expected.txRef) {
      throw new GatewayVerificationError('unknown-reference')
    }
    if (parseVndAmount(order.amount) !== expected.amount) {
      throw new GatewayVerificationError('amount-mismatch')
    }
    return {
      txRef: expected.txRef,
      amount: expected.amount,
      succeeded,
      providerTransactionId,
    }
  }
}

function parseData(
  record: Record<string, unknown>
): Record<string, unknown> | null {
  const rawData = stringField(record, 'data')
  if (!rawData) return null
  try {
    return asRecord(JSON.parse(rawData))
  } catch {
    return null
  }
}
