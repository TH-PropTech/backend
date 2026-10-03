import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes, randomUUID } from 'node:crypto'
import type { PaymentsConfig } from '../../../config/configuration'
import type {
  PaymentIntentInput,
  PaymentProviderAdapter,
  ProviderAccountLink,
  ProviderPaymentIntent,
} from './payment-provider.port'
import {
  asRecord,
  hmacHex,
  isHttpsUrl,
  logField,
  postToGateway,
  type GatewayFetcher,
} from './gateway.util'

/** MoMo AIO v2 `captureWallet` create-order adapter. */
@Injectable()
export class MomoAdapter implements PaymentProviderAdapter {
  readonly name = 'momo' as const
  private readonly logger = new Logger(MomoAdapter.name)
  private readonly fetcher: GatewayFetcher

  constructor(
    private readonly configService: ConfigService,
    @Optional() fetcher?: GatewayFetcher
  ) {
    this.fetcher = fetcher ?? globalThis.fetch
  }

  newTxRef(): string {
    return `MOMO-${randomBytes(12).toString('hex')}`
  }

  async createPaymentIntent(
    input: PaymentIntentInput
  ): Promise<ProviderPaymentIntent> {
    const config = this.configService.getOrThrow<PaymentsConfig['momo']>(
      'rentalFlow.payments.momo'
    )
    const requestId = randomUUID()
    const requestType = 'captureWallet'
    const extraData = ''
    const rawSignature =
      `accessKey=${config.accessKey}&amount=${input.amount}` +
      `&extraData=${extraData}&ipnUrl=${config.ipnUrl}` +
      `&orderId=${input.txRef}&orderInfo=${input.description}` +
      `&partnerCode=${config.partnerCode}&redirectUrl=${config.returnUrl}` +
      `&requestId=${requestId}&requestType=${requestType}`
    const body = {
      partnerCode: config.partnerCode,
      requestId,
      amount: input.amount,
      orderId: input.txRef,
      orderInfo: input.description,
      redirectUrl: config.returnUrl,
      ipnUrl: config.ipnUrl,
      requestType,
      extraData,
      lang: 'vi',
      orderExpireTime: Math.max(
        1,
        Math.ceil((input.expiresAt.getTime() - Date.now()) / 60_000)
      ),
      signature: hmacHex('sha256', config.secretKey, rawSignature),
    }
    const reply = await postToGateway(
      this.fetcher,
      config.endpoint,
      {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      this.configService.getOrThrow<number>(
        'rentalFlow.payments.gatewayTimeoutMs'
      )
    )
    const result = asRecord(reply.body)
    if (!result || result.resultCode !== 0 || !isHttpsUrl(result.payUrl)) {
      this.logger.warn(
        `MoMo create rejected txRef=${input.txRef} http=${logField(reply.status)} resultCode=${logField(result?.resultCode)} message=${logField(result?.message)}`
      )
      throw new ServiceUnavailableException('PAYMENT_GATEWAY_UNAVAILABLE')
    }
    return {
      provider: this.name,
      txRef: input.txRef,
      redirectUrl: result.payUrl,
      expiresAt: input.expiresAt,
    }
  }

  getAccountLink(userId: string): Promise<ProviderAccountLink> {
    return Promise.resolve({
      provider: this.name,
      externalAccountRef: `momo:${userId}`,
      status: 'unlinked',
      simulation: false,
    })
  }
}
