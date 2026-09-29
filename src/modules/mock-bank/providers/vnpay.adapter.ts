import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type {
  PaymentProviderAdapter,
  ProviderAccountLink,
  ProviderPaymentIntent,
} from './payment-provider.port'

type FetchResponse = { ok: boolean; json(): Promise<unknown> }
type Fetcher = (url: string, init: RequestInit) => Promise<FetchResponse>

/** Token dùng để inject custom fetcher (chủ yếu cho test). */
export const VNPAY_FETCHER = 'VNPAY_FETCHER'

@Injectable()
export class VnpayAdapter implements PaymentProviderAdapter {
  readonly name = 'vnpay' as const
  private readonly _fetcher: Fetcher

  constructor(
    private readonly configService: ConfigService,
    @Optional() fetcher?: Fetcher
  ) {
    this._fetcher = fetcher ?? globalThis.fetch
  }

  async createPaymentIntent(input: {
    amount: number
    description: string
    customerRef: string
    txRef: string
  }): Promise<ProviderPaymentIntent> {
    const response = await this._fetcher(
      this.configService.getOrThrow<string>('rentalFlow.vnpayGatewayUrl'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transactionId: input.txRef,
          amount: input.amount,
          returnUrl: this.configService.getOrThrow<string>(
            'rentalFlow.vnpayReturnUrl'
          ),
          language: 'vn',
        }),
      }
    )
    const body: unknown = response.ok ? await response.json() : null
    if (!isPaymentUrlResponse(body)) {
      throw new ServiceUnavailableException('VNPAY_GATEWAY_UNAVAILABLE')
    }
    return {
      provider: this.name,
      txRef: input.txRef,
      redirectUrl: body.paymentUrl,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    }
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

function isPaymentUrlResponse(value: unknown): value is { paymentUrl: string } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('paymentUrl' in value) ||
    typeof value.paymentUrl !== 'string'
  ) {
    return false
  }
  try {
    const url = new URL(value.paymentUrl)
    return url.protocol === 'https:'
  } catch {
    return false
  }
}
