import { Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes } from 'node:crypto'
import type { PaymentsConfig } from '../../../config/configuration'
import type {
  GatewayQueryInput,
  GatewayQueryResult,
  PaymentIntentInput,
  PaymentProviderAdapter,
  ProviderAccountLink,
  ProviderPaymentIntent,
} from './payment-provider.port'
import {
  asRecord,
  formatVnTimestamp,
  hmacHex,
  logField,
  postToGateway,
  sameSignature,
  stringField,
  unavailableQuery,
  type GatewayFetcher,
} from './gateway.util'
import { vnpayCanonicalQuery } from './vnpay-callback.verifier'

/** Builds and signs VNPAY 2.1.0 payment URLs locally (no bridge service). */
@Injectable()
export class VnpayAdapter implements PaymentProviderAdapter {
  readonly name = 'vnpay' as const

  private readonly logger = new Logger(VnpayAdapter.name)
  private readonly fetcher: GatewayFetcher

  constructor(
    private readonly configService: ConfigService,
    @Optional() fetcher?: GatewayFetcher
  ) {
    this.fetcher = fetcher ?? globalThis.fetch
  }

  newTxRef(): string {
    return `VNPAY-${randomBytes(12).toString('hex')}`
  }

  createPaymentIntent(
    input: PaymentIntentInput
  ): Promise<ProviderPaymentIntent> {
    const config = this.configService.getOrThrow<PaymentsConfig['vnpay']>(
      'rentalFlow.payments.vnpay'
    )
    const params: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: config.tmnCode,
      vnp_Amount: String(input.amount * 100),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: input.txRef,
      vnp_OrderInfo: input.description,
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: config.returnUrl,
      vnp_IpAddr: normalizeIp(input.clientIp),
      vnp_CreateDate: formatVnTimestamp(new Date()),
      vnp_ExpireDate: formatVnTimestamp(input.expiresAt),
    }
    const query = vnpayCanonicalQuery(params)
    const secureHash = hmacHex('sha512', config.hashSecret, query)
    return Promise.resolve({
      provider: this.name,
      txRef: input.txRef,
      redirectUrl: `${config.payUrl}?${query}&vnp_SecureHash=${secureHash}`,
      expiresAt: input.expiresAt,
    })
  }

  /** VNPAY merchant_webapi `querydr` (HMAC-SHA512, pipe-joined fields). Read-only. */
  async queryStatus(input: GatewayQueryInput): Promise<GatewayQueryResult> {
    try {
      const config = this.configService.getOrThrow<PaymentsConfig['vnpay']>(
        'rentalFlow.payments.vnpay'
      )
      const body = {
        vnp_RequestId: randomBytes(16).toString('hex'),
        vnp_Version: '2.1.0',
        vnp_Command: 'querydr',
        vnp_TmnCode: config.tmnCode,
        vnp_TxnRef: input.txRef,
        vnp_OrderInfo: `Truy van GD ${input.txRef}`,
        vnp_TransactionDate: formatVnTimestamp(input.createdAt),
        vnp_CreateDate: formatVnTimestamp(new Date()),
        vnp_IpAddr: '127.0.0.1',
      }
      const vnp_SecureHash = hmacHex(
        'sha512',
        config.hashSecret,
        [
          body.vnp_RequestId,
          body.vnp_Version,
          body.vnp_Command,
          body.vnp_TmnCode,
          body.vnp_TxnRef,
          body.vnp_TransactionDate,
          body.vnp_CreateDate,
          body.vnp_IpAddr,
          body.vnp_OrderInfo,
        ].join('|')
      )
      const reply = await postToGateway(
        this.fetcher,
        config.queryEndpoint,
        {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, vnp_SecureHash }),
        },
        this.configService.getOrThrow<number>(
          'rentalFlow.payments.gatewayTimeoutMs'
        )
      )
      const result = asRecord(reply.body)
      const responseCode = result
        ? stringField(result, 'vnp_ResponseCode')
        : null
      if (!result || !responseCode) {
        this.logger.warn(
          `VNPAY query unavailable txRef=${input.txRef} http=${logField(reply.status)}`
        )
        return unavailableQuery('VNPAY không phản hồi hợp lệ.')
      }
      if (responseCode !== '00' && responseCode !== '91') {
        // e.g. 02 'Website not approved': the merchant cannot use querydr.
        return unavailableQuery(
          stringField(result, 'vnp_Message') ?? 'VNPAY từ chối truy vấn.',
          responseCode
        )
      }
      if (!this.responseSignatureValid(result, config)) {
        this.logger.warn(
          `VNPAY query bad response signature txRef=${input.txRef}`
        )
        return unavailableQuery(
          'Chữ ký phản hồi VNPAY không hợp lệ.',
          responseCode
        )
      }
      const txStatus = stringField(result, 'vnp_TransactionStatus')
      const amountRaw = stringField(result, 'vnp_Amount')
      const base = {
        providerTransactionId: stringField(result, 'vnp_TransactionNo'),
        amount:
          amountRaw !== null && /^\d+$/.test(amountRaw)
            ? Number(amountRaw) / 100
            : null,
        rawCode: txStatus ? `${responseCode}/${txStatus}` : responseCode,
        message: stringField(result, 'vnp_Message')?.slice(0, 160) ?? null,
      }
      if (responseCode === '91') return { state: 'not_found', ...base }
      if (txStatus === '00') return { state: 'succeeded', ...base }
      if (txStatus === '01') return { state: 'pending', ...base }
      if (['02', '04', '07', '09'].includes(txStatus ?? '')) {
        return { state: 'failed', ...base }
      }
      return unavailableQuery(
        'VNPAY trả trạng thái không xác định.',
        base.rawCode
      )
    } catch {
      this.logger.warn(`VNPAY query error txRef=${input.txRef}`)
      return unavailableQuery('Không truy vấn được VNPAY.')
    }
  }

  /** The response hash covers a fixed pipe-joined field list (missing = empty). */
  private responseSignatureValid(
    result: Record<string, unknown>,
    config: PaymentsConfig['vnpay']
  ): boolean {
    const received = stringField(result, 'vnp_SecureHash')
    if (!received) return false
    const field = (key: string): string => stringField(result, key) ?? ''
    const data = [
      field('vnp_ResponseId'),
      field('vnp_Command'),
      field('vnp_ResponseCode'),
      field('vnp_Message'),
      config.tmnCode,
      field('vnp_TxnRef'),
      field('vnp_Amount'),
      field('vnp_BankCode'),
      field('vnp_PayDate'),
      field('vnp_TransactionNo'),
      field('vnp_TransactionType'),
      field('vnp_TransactionStatus'),
      field('vnp_OrderInfo'),
      field('vnp_PromotionCode'),
      field('vnp_PromotionAmount'),
    ].join('|')
    return sameSignature(received, hmacHex('sha512', config.hashSecret, data))
  }

  getAccountLink(userId: string): Promise<ProviderAccountLink> {
    return Promise.resolve({
      provider: this.name,
      externalAccountRef: `vnpay:${userId}`,
      status: 'unlinked',
      simulation: false,
    })
  }
}

/** VNPAY expects an IPv4-looking address; map loopback/IPv4-mapped forms. */
function normalizeIp(ip: string | undefined): string {
  if (!ip || ip === '::1') return '127.0.0.1'
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip
}
