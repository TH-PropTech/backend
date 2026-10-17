import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes } from 'node:crypto'
import type { PaymentsConfig } from '../../../config/configuration'
import type {
  PaymentIntentInput,
  PaymentProviderAdapter,
  ProviderAccountLink,
  ProviderPaymentIntent,
} from './payment-provider.port'
import {
  asRecord,
  isHttpsUrl,
  logField,
  postToGateway,
  type GatewayFetcher,
} from './gateway.util'

/** Ví Mộc per-transaction limit in VND (INTEGRATION.md section 1). */
export const MOCBANK_MAX_AMOUNT = 50_000_000
const MAX_DESCRIPTION_LENGTH = 200
const MIN_EXPIRES_MINUTES = 1
const MAX_EXPIRES_MINUTES = 60

export function mocbankMerchantHeaders(
  config: PaymentsConfig['mocbank']
): Record<string, string> {
  return {
    'X-Merchant-Id': config.merchantId,
    'X-Merchant-Secret': config.merchantSecret,
  }
}

export function isSuccessStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300
}

function sameOrigin(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin
  } catch {
    return false
  }
}

/** Ví Mộc sandbox payment-session adapter (server-to-server create). */
@Injectable()
export class MocbankAdapter implements PaymentProviderAdapter {
  readonly name = 'mocbank' as const
  private readonly logger = new Logger(MocbankAdapter.name)
  private readonly fetcher: GatewayFetcher

  constructor(
    private readonly configService: ConfigService,
    @Optional() fetcher?: GatewayFetcher
  ) {
    this.fetcher = fetcher ?? globalThis.fetch
  }

  newTxRef(): string {
    return `MOCBANK-${randomBytes(12).toString('hex')}`
  }

  async createPaymentIntent(
    input: PaymentIntentInput
  ): Promise<ProviderPaymentIntent> {
    if (input.amount > MOCBANK_MAX_AMOUNT) {
      // Fail before calling Ví Mộc so the tenant sees why, not a gateway error.
      throw new BadRequestException('PAYMENT_AMOUNT_OUT_OF_RANGE')
    }
    const config = this.configService.getOrThrow<PaymentsConfig['mocbank']>(
      'rentalFlow.payments.mocbank'
    )
    const expiresInMinutes = Math.min(
      MAX_EXPIRES_MINUTES,
      Math.max(
        MIN_EXPIRES_MINUTES,
        Math.ceil((input.expiresAt.getTime() - Date.now()) / 60_000)
      )
    )
    const body = {
      orderId: input.txRef,
      amount: input.amount,
      description: input.description.slice(0, MAX_DESCRIPTION_LENGTH),
      returnUrl: config.returnUrl,
      cancelUrl: config.returnUrl,
      // Ví Mộc falls back to the app's first registered webhook when omitted.
      ...(config.webhookUrl ? { webhookUrl: config.webhookUrl } : {}),
      expiresInMinutes,
      channel: input.clientChannel ?? 'web',
      // Có thì tiền đi thẳng vào tài khoản này (chủ nhà), không qua ví của sàn.
      ...(input.payeeAccountNumber
        ? { payeeAccountNumber: input.payeeAccountNumber }
        : {}),
    }
    const reply = await postToGateway(
      this.fetcher,
      `${config.baseUrl}/api/payments/create`,
      {
        headers: {
          'content-type': 'application/json',
          ...mocbankMerchantHeaders(config),
        },
        body: JSON.stringify(body),
      },
      this.configService.getOrThrow<number>(
        'rentalFlow.payments.gatewayTimeoutMs'
      )
    )
    const result = asRecord(reply.body)
    const data = asRecord(result?.data)
    const paymentUrl = data?.paymentUrl
    if (asRecord(result?.error)?.code === 'PAYEE_NOT_FOUND') {
      // Tài khoản nhận của chủ nhà không tồn tại trên Ví Mộc: khách chưa mất tiền.
      throw new UnprocessableEntityException('LANDLORD_PAYEE_ACCOUNT_INVALID')
    }
    if (
      !isSuccessStatus(reply.status) ||
      !result ||
      result.success !== true ||
      !data ||
      !isHttpsUrl(paymentUrl) ||
      !sameOrigin(paymentUrl, config.baseUrl) ||
      data.orderId !== input.txRef ||
      data.amount !== input.amount
    ) {
      this.logger.warn(
        `Ví Mộc create rejected txRef=${input.txRef} http=${logField(reply.status)} code=${logField(asRecord(result?.error)?.code)}`
      )
      throw new ServiceUnavailableException('PAYMENT_GATEWAY_UNAVAILABLE')
    }
    return {
      provider: this.name,
      txRef: input.txRef,
      redirectUrl: paymentUrl,
      expiresAt: input.expiresAt,
    }
  }

  getAccountLink(userId: string): Promise<ProviderAccountLink> {
    return Promise.resolve({
      provider: this.name,
      externalAccountRef: `mocbank:${userId}`,
      status: 'unlinked',
      simulation: false,
    })
  }
}
