import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes } from 'node:crypto'
import type { PaymentsConfig } from '../../../config/configuration'
import type {
  PaymentIntentInput,
  PaymentProviderAdapter,
  ProviderAccountLink,
  ProviderPaymentIntent,
} from './payment-provider.port'
import { formatVnTimestamp, hmacHex } from './gateway.util'
import { vnpayCanonicalQuery } from './vnpay-callback.verifier'

/** Builds and signs VNPAY 2.1.0 payment URLs locally (no bridge service). */
@Injectable()
export class VnpayAdapter implements PaymentProviderAdapter {
  readonly name = 'vnpay' as const

  constructor(private readonly configService: ConfigService) {}

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
