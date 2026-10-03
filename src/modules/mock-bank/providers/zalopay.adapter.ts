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
  PaymentIntentInput,
  PaymentProviderAdapter,
  ProviderAccountLink,
  ProviderPaymentIntent,
} from './payment-provider.port'
import {
  asRecord,
  formatVnShortDate,
  hmacHex,
  isHttpsUrl,
  logField,
  postToGateway,
  type GatewayFetcher,
} from './gateway.util'

const MIN_EXPIRE_SECONDS = 300

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
      bank_code: '',
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

  getAccountLink(userId: string): Promise<ProviderAccountLink> {
    return Promise.resolve({
      provider: this.name,
      externalAccountRef: `zalopay:${userId}`,
      status: 'unlinked',
      simulation: false,
    })
  }
}
