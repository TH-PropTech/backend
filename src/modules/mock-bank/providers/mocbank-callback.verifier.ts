import { Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { PaymentsConfig } from '../../../config/configuration'
import { isSuccessStatus, mocbankMerchantHeaders } from './mocbank.adapter'
import {
  GatewayVerificationError,
  type GatewayCallbackKind,
  type GatewayVerdict,
  type GatewayVerifier,
} from './payment-provider.port'
import {
  asRecord,
  getFromGateway,
  hmacHex,
  logField,
  parseVndAmount,
  sameSignature,
  stringField,
  type GatewayFetcher,
} from './gateway.util'

type Expected = Parameters<GatewayVerifier['verify']>[2]

const WEBHOOK_TOLERANCE_MS = 5 * 60_000
const RETURN_TOLERANCE_SECONDS = 15 * 60
const PAYMENT_ID_PATTERN = /^PAY_[A-Za-z0-9]+$/
const FAILED_EVENTS = ['payment.cancelled', 'payment.expired']
const FAILED_STATUSES = ['CANCELLED', 'EXPIRED']

export type MocbankWebhookHeaders = Record<
  string,
  string | string[] | undefined
>

export type MocbankWebhookEnvelope = {
  event: string
  body: Record<string, unknown>
}

function headerValue(
  headers: MocbankWebhookHeaders,
  name: string
): string | null {
  const value = headers[name]
  return typeof value === 'string' && value !== '' ? value : null
}

@Injectable()
export class MocbankCallbackVerifier implements GatewayVerifier {
  readonly name = 'mocbank' as const
  private readonly logger = new Logger(MocbankCallbackVerifier.name)
  private readonly fetcher: GatewayFetcher

  constructor(
    private readonly configService: ConfigService,
    @Optional() fetcher?: GatewayFetcher
  ) {
    this.fetcher = fetcher ?? globalThis.fetch
  }

  /**
   * Authenticates a webhook on the exact bytes received: HMAC-SHA256 of
   * `<timestamp>.<raw body>` within a 5 minute window. Runs before any
   * attempt lookup.
   */
  verifyWebhookEnvelope(
    rawBody: string,
    headers: MocbankWebhookHeaders
  ): MocbankWebhookEnvelope {
    const timestamp = headerValue(headers, 'x-sandbox-timestamp')
    const signature = headerValue(headers, 'x-sandbox-signature')
    if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
      throw new GatewayVerificationError('invalid-signature')
    }
    if (Math.abs(Date.now() - Number(timestamp)) > WEBHOOK_TOLERANCE_MS) {
      throw new GatewayVerificationError('invalid-signature')
    }
    const config = this.config()
    const expected = hmacHex(
      'sha256',
      config.merchantSecret,
      `${timestamp}.${rawBody}`
    )
    if (!sameSignature(signature, expected)) {
      throw new GatewayVerificationError('invalid-signature')
    }
    const body = this.parseBody(rawBody)
    const event = stringField(body, 'event')
    if (!event) throw new GatewayVerificationError('invalid-payload')
    return { event, body }
  }

  extractTxRef(payload: unknown, kind: GatewayCallbackKind): string | null {
    const record = asRecord(payload)
    return record
      ? stringField(record, kind === 'return' ? 'moc_order_id' : 'orderId')
      : null
  }

  async verify(
    payload: unknown,
    kind: GatewayCallbackKind,
    expected: Expected
  ): Promise<GatewayVerdict> {
    const record = asRecord(payload)
    if (!record) throw new GatewayVerificationError('invalid-payload')
    return kind === 'return'
      ? this.verifyReturn(record, expected)
      : this.verifyNotify(record, expected)
  }

  private async verifyNotify(
    record: Record<string, unknown>,
    expected: Expected
  ): Promise<GatewayVerdict> {
    const orderId = stringField(record, 'orderId')
    const event = stringField(record, 'event')
    if (!orderId || !event) {
      throw new GatewayVerificationError('invalid-payload')
    }
    if (orderId !== expected.txRef) {
      throw new GatewayVerificationError('unknown-reference')
    }
    if (parseVndAmount(record.amount) !== expected.amount) {
      throw new GatewayVerificationError('amount-mismatch')
    }
    if (FAILED_EVENTS.includes(event)) return this.unsucceeded(expected)
    if (event !== 'payment.success') {
      throw new GatewayVerificationError('invalid-payload')
    }
    return this.reconcile(stringField(record, 'paymentId'), expected)
  }

  private async verifyReturn(
    record: Record<string, unknown>,
    expected: Expected
  ): Promise<GatewayVerdict> {
    const paymentId = stringField(record, 'moc_payment_id')
    const orderId = stringField(record, 'moc_order_id')
    const status = stringField(record, 'moc_status')
    const timestamp = stringField(record, 'moc_ts')
    const signature = stringField(record, 'moc_sig')
    if (!paymentId || !orderId || !status || !timestamp || !signature) {
      throw new GatewayVerificationError('invalid-payload')
    }
    const signed = [paymentId, orderId, status, timestamp].join('.')
    if (
      !sameSignature(
        signature,
        hmacHex('sha256', this.config().merchantSecret, signed)
      )
    ) {
      throw new GatewayVerificationError('invalid-signature')
    }
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
    if (!/^\d+$/.test(timestamp) || ageSeconds > RETURN_TOLERANCE_SECONDS) {
      throw new GatewayVerificationError('invalid-signature')
    }
    if (orderId !== expected.txRef) {
      throw new GatewayVerificationError('unknown-reference')
    }
    if (FAILED_STATUSES.includes(status)) return this.unsucceeded(expected)
    if (status !== 'SUCCESS') {
      throw new GatewayVerificationError('invalid-payload')
    }
    return this.reconcile(paymentId, expected)
  }

  /**
   * Server-to-server check of a claimed success. A transport or HTTP failure
   * throws a plain Error (not a verification error) so the caller reports a
   * retryable internal error instead of rejecting the callback.
   */
  private async reconcile(
    paymentId: string | null,
    expected: Expected
  ): Promise<GatewayVerdict> {
    if (!paymentId || !PAYMENT_ID_PATTERN.test(paymentId)) {
      throw new GatewayVerificationError('invalid-payload')
    }
    const config = this.config()
    const reply = await getFromGateway(
      this.fetcher,
      `${config.baseUrl}/api/payments/${encodeURIComponent(paymentId)}`,
      mocbankMerchantHeaders(config),
      this.configService.getOrThrow<number>(
        'rentalFlow.payments.gatewayTimeoutMs'
      )
    )
    const result = asRecord(reply.body)
    const data = asRecord(result?.data)
    if (!isSuccessStatus(reply.status) || !data) {
      this.logger.warn(
        `Ví Mộc reconcile failed txRef=${expected.txRef} http=${logField(reply.status)} code=${logField(asRecord(result?.error)?.code)}`
      )
      throw new Error('MOCBANK_RECONCILE_UNAVAILABLE')
    }
    if (stringField(data, 'orderId') !== expected.txRef) {
      throw new GatewayVerificationError('unknown-reference')
    }
    if (parseVndAmount(data.amount) !== expected.amount) {
      throw new GatewayVerificationError('amount-mismatch')
    }
    if (data.status !== 'SUCCESS') {
      throw new GatewayVerificationError('amount-mismatch')
    }
    // Tiền phải vào đúng tài khoản đã gắn vào lần thử (chủ nhà), hoặc ví của sàn khi không gắn.
    if (
      (stringField(data, 'payeeAccountNumber') ?? null) !==
      (expected.payeeAccountNumber ?? null)
    ) {
      throw new GatewayVerificationError('payee-mismatch')
    }
    return {
      txRef: expected.txRef,
      amount: expected.amount,
      succeeded: true,
      providerTransactionId: stringField(data, 'transactionCode'),
    }
  }

  private unsucceeded(expected: {
    txRef: string
    amount: number
  }): GatewayVerdict {
    return {
      txRef: expected.txRef,
      amount: expected.amount,
      succeeded: false,
      providerTransactionId: null,
    }
  }

  private parseBody(rawBody: string): Record<string, unknown> {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      throw new GatewayVerificationError('invalid-payload')
    }
    const body = asRecord(parsed)
    if (!body) throw new GatewayVerificationError('invalid-payload')
    return body
  }

  private config(): PaymentsConfig['mocbank'] {
    return this.configService.getOrThrow<PaymentsConfig['mocbank']>(
      'rentalFlow.payments.mocbank'
    )
  }
}
