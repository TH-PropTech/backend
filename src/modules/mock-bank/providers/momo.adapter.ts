import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes, randomUUID } from 'node:crypto'
import type { PaymentsConfig } from '../../../config/configuration'
import type {
  GatewayQueryInput,
  GatewayQueryResult,
  MomoPaymentMethod,
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
  parseVndAmount,
  postToGateway,
  stringField,
  unavailableQuery,
  type GatewayFetcher,
} from './gateway.util'

/** MoMo resultCodes still in flight (docs: result-handling/resultcode). */
const MOMO_PENDING_CODES = new Set([1000, 7000, 7002, 9000])
/** MoMo resultCodes for an unknown order (sandbox: 1005 "expired or did not exist"). */
const MOMO_NOT_FOUND_CODES = new Set([42, 1005])

export type MomoMethodOption = {
  method: MomoPaymentMethod
  label: string
  minAmount: number
  maxAmount: number
}

/** MoMo AIO v2 request types and their per-order VND limits (MoMo docs). */
const MOMO_METHODS: Record<
  MomoPaymentMethod,
  MomoMethodOption & { requestType: string }
> = {
  wallet: {
    method: 'wallet',
    label: 'Ví MoMo / QR',
    requestType: 'captureWallet',
    minAmount: 1_000,
    maxAmount: 50_000_000,
  },
  atm: {
    method: 'atm',
    label: 'Thẻ ATM nội địa',
    requestType: 'payWithATM',
    minAmount: 10_000,
    maxAmount: 50_000_000,
  },
  card: {
    method: 'card',
    label: 'Thẻ Visa / Master / JCB',
    requestType: 'payWithCC',
    minAmount: 1_000,
    maxAmount: 10_000_000,
  },
}

/** Public method list for the provider picker (no request internals). */
export const MOMO_METHOD_OPTIONS: MomoMethodOption[] = Object.values(
  MOMO_METHODS
).map(({ method, label, minAmount, maxAmount }) => ({
  method,
  label,
  minAmount,
  maxAmount,
}))

/** MoMo AIO v2 create-order adapter (wallet, ATM or international card). */
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
    const method = MOMO_METHODS[input.momoMethod ?? 'wallet']
    if (input.amount < method.minAmount || input.amount > method.maxAmount) {
      // Fail before calling MoMo so the tenant sees why, not a gateway error.
      throw new BadRequestException('PAYMENT_AMOUNT_OUT_OF_RANGE')
    }
    const requestId = randomUUID()
    const requestType = method.requestType
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

  /** MoMo `/query`: read-only order status (HMAC-SHA256 over accessKey/orderId/partnerCode/requestId). */
  async queryStatus(input: GatewayQueryInput): Promise<GatewayQueryResult> {
    try {
      const config = this.configService.getOrThrow<PaymentsConfig['momo']>(
        'rentalFlow.payments.momo'
      )
      const requestId = randomUUID()
      const rawSignature =
        `accessKey=${config.accessKey}&orderId=${input.txRef}` +
        `&partnerCode=${config.partnerCode}&requestId=${requestId}`
      const reply = await postToGateway(
        this.fetcher,
        config.queryEndpoint,
        {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            partnerCode: config.partnerCode,
            requestId,
            orderId: input.txRef,
            lang: 'vi',
            signature: hmacHex('sha256', config.secretKey, rawSignature),
          }),
        },
        this.configService.getOrThrow<number>(
          'rentalFlow.payments.gatewayTimeoutMs'
        )
      )
      const result = asRecord(reply.body)
      const code = result?.resultCode
      if (!result || typeof code !== 'number') {
        this.logger.warn(
          `MoMo query unavailable txRef=${input.txRef} http=${logField(reply.status)}`
        )
        return unavailableQuery('MoMo không phản hồi hợp lệ.')
      }
      const base = {
        providerTransactionId: stringField(result, 'transId'),
        amount: parseVndAmount(result.amount),
        rawCode: String(code),
        message: stringField(result, 'message')?.slice(0, 160) ?? null,
      }
      if (code === 0) return { state: 'succeeded', ...base }
      if (MOMO_PENDING_CODES.has(code)) return { state: 'pending', ...base }
      if (MOMO_NOT_FOUND_CODES.has(code)) return { state: 'not_found', ...base }
      // 10/11 are merchant-side system errors, not a verdict on the order.
      if (code === 10 || code === 11) {
        return unavailableQuery(
          base.message ?? 'MoMo đang bảo trì.',
          base.rawCode
        )
      }
      return { state: 'failed', ...base }
    } catch {
      this.logger.warn(`MoMo query error txRef=${input.txRef}`)
      return unavailableQuery('Không truy vấn được MoMo.')
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
