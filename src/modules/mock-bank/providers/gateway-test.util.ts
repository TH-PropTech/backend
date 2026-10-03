import type { PaymentsConfig } from '../../../config/configuration'

/** Synthetic sandbox-shaped config shared by gateway specs (no real keys). */
export const TEST_PAYMENTS: PaymentsConfig = {
  enabledProviders: ['mock-bank', 'vnpay', 'momo', 'zalopay'],
  gatewayTimeoutMs: 5000,
  attemptTtlMinutes: 15,
  clientReturnUrl: 'http://localhost:3000',
  mobileReturnUrl: 'thproptech://payment-result',
  vnpay: {
    tmnCode: 'TESTTMN1',
    hashSecret: 'vnpay-test-secret',
    payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    returnUrl: 'http://localhost:3001/api/v1/bank/vnpay/return',
  },
  momo: {
    partnerCode: 'MOMOTEST',
    accessKey: 'momo-access-key',
    secretKey: 'momo-secret-key',
    endpoint: 'https://test-payment.momo.vn/v2/gateway/api/create',
    returnUrl: 'http://localhost:3001/api/v1/bank/momo/return',
    ipnUrl: 'https://tunnel.example/api/v1/bank/momo/ipn',
  },
  zalopay: {
    appId: '2553',
    key1: 'zalopay-key1',
    key2: 'zalopay-key2',
    endpoint: 'https://sb-openapi.zalopay.vn/v2/create',
    returnUrl: 'http://localhost:3001/api/v1/bank/zalopay/return',
    callbackUrl: 'https://tunnel.example/api/v1/bank/zalopay/callback',
  },
}

/** Every secret in TEST_PAYMENTS, for log-hygiene assertions. */
export const TEST_SECRETS = [
  TEST_PAYMENTS.vnpay.hashSecret,
  TEST_PAYMENTS.momo.accessKey,
  TEST_PAYMENTS.momo.secretKey,
  TEST_PAYMENTS.zalopay.key1,
  TEST_PAYMENTS.zalopay.key2,
]

export function testConfigService(
  payments: PaymentsConfig = TEST_PAYMENTS,
  extra: Record<string, unknown> = {}
): {
  get: (key: string) => unknown
  getOrThrow: (key: string) => unknown
} {
  const values: Record<string, unknown> = {
    'rentalFlow.payments': payments,
    'rentalFlow.payments.enabledProviders': payments.enabledProviders,
    'rentalFlow.payments.gatewayTimeoutMs': payments.gatewayTimeoutMs,
    'rentalFlow.payments.attemptTtlMinutes': payments.attemptTtlMinutes,
    'rentalFlow.payments.vnpay': payments.vnpay,
    'rentalFlow.payments.momo': payments.momo,
    'rentalFlow.payments.zalopay': payments.zalopay,
    ...extra,
  }
  return {
    get: (key: string): unknown => values[key],
    getOrThrow: (key: string): unknown => {
      if (!(key in values)) throw new Error(`missing config ${key}`)
      return values[key]
    },
  }
}

export function jsonFetcher(body: unknown, ok = true): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok,
    json: jest.fn().mockResolvedValue(body),
  })
}
