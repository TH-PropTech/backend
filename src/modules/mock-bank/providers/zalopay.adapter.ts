import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes } from 'node:crypto'
import type { PaymentsConfig } from '../../../config/configuration'
import type {
  GatewayQueryInput,
  GatewayQueryResult,
  PaymentIntentInput,
  PaymentProviderAdapter,
  ProviderAccountLink,
  ProviderPaymentIntent,
  ZalopayPaymentMethod,
} from './payment-provider.port'
import {
  asRecord,
  formatVnShortDate,
  hmacHex,
  isHttpsUrl,
  logField,
  parseVndAmount,
  postToGateway,
  stringField,
  unavailableQuery,
  type GatewayFetcher,
} from './gateway.util'

const MIN_EXPIRE_SECONDS = 300

export type ZalopayMethodOption = {
  method: ZalopayPaymentMethod
  label: string
}

/** ZaloPay `bank_code` per method: "" = gateway page, CC = card entry page. */
const ZALOPAY_METHODS: Record<
  ZalopayPaymentMethod,
  ZalopayMethodOption & { bankCode: string }
> = {
  all: { method: 'all', label: 'ZaloPay (ví / QR / ATM)', bankCode: '' },
  card: {
    method: 'card',
    label: 'ZaloPay - Thẻ Visa / Master / JCB',
    bankCode: 'CC',
  },
}

/** Public method list for the provider picker (no request internals). */
export const ZALOPAY_METHOD_OPTIONS: ZalopayMethodOption[] = Object.values(
  ZALOPAY_METHODS
).map(({ method, label }) => ({ method, label }))

/** ZaloPay v2 `/create` adapter (form-urlencoded, key1 MAC). */
@Injectable()
export class ZalopayAdapter implements PaymentProviderAdapter {
  readonly name = 'zalopay' as const
  private readonly logger = new Logger(ZalopayAdapter.name)
  private readonly fetcher: GatewayFetcher

  constructor(
    private readonly configService: ConfigService,
    @Optional() fetcher?: GatewayFetcher
  ) {
    this.fetcher = fetcher ?? globalThis.fetch
  }

  /** ZaloPay requires `yyMMdd_` (Vietnam date) as the app_trans_id prefix. */
  newTxRef(): string {
    return `${formatVnShortDate(new Date())}_${randomBytes(12).toString('hex')}`
  }

  async createPaymentIntent(
    input: PaymentIntentInput
  ): Promise<ProviderPaymentIntent> {
    const config = this.configService.getOrThrow<PaymentsConfig['zalopay']>(
      'rentalFlow.payments.zalopay'
    )
    const order: Record<string, string> = {
      app_id: config.appId,
      app_trans_id: input.txRef,
      app_user: `u${createHash('sha256').update(input.customerRef).digest('hex').slice(0, 16)}`,
      app_time: String(Date.now()),
      amount: String(input.amount),
      item: '[]',
      embed_data: JSON.stringify({ redirecturl: config.returnUrl }),
      description: `TH-PropTech - ${input.description}`,
      bank_code: ZALOPAY_METHODS[input.zalopayMethod ?? 'all'].bankCode,
      callback_url: config.callbackUrl,
      expire_duration_seconds: String(
        Math.max(
          MIN_EXPIRE_SECONDS,
          Math.floor((input.expiresAt.getTime() - Date.now()) / 1000)
        )
      ),
    }
    order.mac = hmacHex(
      'sha256',
      config.key1,
      [
        order.app_id,
        order.app_trans_id,
        order.app_user,
        order.amount,
        order.app_time,
        order.embed_data,
        order.item,
      ].join('|')
    )
    const reply = await postToGateway(
      this.fetcher,
      config.endpoint,
      {
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: new URLSearchParams(order).toString(),
      },
      this.configService.getOrThrow<number>(
        'rentalFlow.payments.gatewayTimeoutMs'
      )
    )
    const result = asRecord(reply.body)
    if (!result || result.return_code !== 1 || !isHttpsUrl(result.order_url)) {
      this.logger.warn(
        `ZaloPay create rejected txRef=${input.txRef} http=${logField(reply.status)} returnCode=${logField(result?.return_code)} subCode=${logField(result?.sub_return_code)} message=${logField(result?.sub_return_message ?? result?.return_message)}`
      )
      throw new ServiceUnavailableException('PAYMENT_GATEWAY_UNAVAILABLE')
    }
    return {
      provider: this.name,
      txRef: input.txRef,
      redirectUrl: result.order_url,
      expiresAt: input.expiresAt,
    }
  }

  /** ZaloPay v2 `/query`: read-only status of an order (mac = HMAC(key1, app_id|app_trans_id|key1)). */
  async queryStatus(input: GatewayQueryInput): Promise<GatewayQueryResult> {
    try {
      const config = this.configService.getOrThrow<PaymentsConfig['zalopay']>(
        'rentalFlow.payments.zalopay'
      )
      const mac = hmacHex(
        'sha256',
        config.key1,
        [config.appId, input.txRef, config.key1].join('|')
      )
      const reply = await postToGateway(
        this.fetcher,
        config.queryEndpoint,
        {
          headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          },
          body: new URLSearchParams({
            app_id: config.appId,
            app_trans_id: input.txRef,
            mac,
          }).toString(),
        },
        this.configService.getOrThrow<number>(
          'rentalFlow.payments.gatewayTimeoutMs'
        )
      )
      const result = asRecord(reply.body)
      if (!result || typeof result.return_code !== 'number') {
        this.logger.warn(
          `ZaloPay query unavailable txRef=${input.txRef} http=${logField(reply.status)}`
        )
        return unavailableQuery('ZaloPay không phản hồi hợp lệ.')
      }
      const returnCode = result.return_code
      const subCode = result.sub_return_code
      const rawCode = `${returnCode}${typeof subCode === 'number' ? `/${subCode}` : ''}`
      const message =
        stringField(result, 'sub_return_message') ??
        stringField(result, 'return_message')
      const base = {
        providerTransactionId: stringField(result, 'zp_trans_id'),
        amount: parseVndAmount(result.amount),
        rawCode,
        message: message?.slice(0, 160) ?? null,
      }
      if (returnCode === 1) return { state: 'succeeded', ...base }
      if (returnCode === 3 || result.is_processing === true) {
        return { state: 'pending', ...base }
      }
      // Observed on sandbox: unknown order => return_code 2, sub_return_code -101.
      if (returnCode === 2 && (subCode === -101 || subCode === -49)) {
        return { state: 'not_found', ...base }
      }
      if (returnCode === -49) return { state: 'not_found', ...base }
      if (returnCode === 2) return { state: 'failed', ...base }
      return unavailableQuery('ZaloPay trả mã không xác định.', rawCode)
    } catch {
      this.logger.warn(`ZaloPay query error txRef=${input.txRef}`)
      return unavailableQuery('Không truy vấn được ZaloPay.')
    }
  }

  getAccountLink(userId: string): Promise<ProviderAccountLink> {
    return Promise.resolve({
      provider: this.name,
      externalAccountRef: `zalopay:${userId}`,
      status: 'unlinked',
      simulation: false,
    })
  }
}
