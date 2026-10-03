import { ServiceUnavailableException } from '@nestjs/common'
import { createHmac } from 'node:crypto'
import { MomoAdapter } from './momo.adapter'
import { MomoCallbackVerifier } from './momo-callback.verifier'
import { GatewayVerificationError } from './payment-provider.port'
import {
  jsonFetcher,
  TEST_PAYMENTS,
  testConfigService,
} from './gateway-test.util'

const momo = TEST_PAYMENTS.momo
const input = {
  amount: 2_000_000,
  description: 'Rent 2026-10',
  customerRef: 'tenant-1',
  txRef: 'MOMO-abc',
  expiresAt: new Date(Date.now() + 15 * 60_000),
}

describe('MomoAdapter', () => {
  it('posts a signed captureWallet order and returns the HTTPS payUrl', async () => {
    const fetcher = jsonFetcher({
      resultCode: 0,
      payUrl: 'https://test-payment.momo.vn/v2/gateway/pay?t=1',
    })
    const adapter = new MomoAdapter(testConfigService() as never, fetcher)

    const intent = await adapter.createPaymentIntent(input)

    expect(intent).toMatchObject({
      provider: 'momo',
      txRef: 'MOMO-abc',
      redirectUrl: 'https://test-payment.momo.vn/v2/gateway/pay?t=1',
    })
    const [url, init] = fetcher.mock.calls[0] as [string, { body: string }]
    expect(url).toBe(momo.endpoint)
    const body = JSON.parse(init.body) as Record<string, string | number>
    expect(body).toMatchObject({
      partnerCode: momo.partnerCode,
      orderId: 'MOMO-abc',
      amount: 2_000_000,
      requestType: 'captureWallet',
      redirectUrl: momo.returnUrl,
      ipnUrl: momo.ipnUrl,
    })
    const raw =
      `accessKey=${momo.accessKey}&amount=2000000&extraData=&ipnUrl=${momo.ipnUrl}` +
      `&orderId=MOMO-abc&orderInfo=Rent 2026-10&partnerCode=${momo.partnerCode}` +
      `&redirectUrl=${momo.returnUrl}&requestId=${String(body.requestId)}&requestType=captureWallet`
    expect(body.signature).toBe(
      createHmac('sha256', momo.secretKey).update(raw).digest('hex')
    )
  })

  it.each([
    [
      'a non-zero resultCode',
      jsonFetcher({ resultCode: 1006, payUrl: 'https://x' }),
    ],
    ['a non-HTTPS payUrl', jsonFetcher({ resultCode: 0, payUrl: 'http://x' })],
    ['an HTTP error', jsonFetcher({}, false)],
    ['a transport failure', jest.fn().mockRejectedValue(new Error('timeout'))],
  ])('fails closed on %s', async (_label, fetcher) => {
    const adapter = new MomoAdapter(testConfigService() as never, fetcher)

    await expect(adapter.createPaymentIntent(input)).rejects.toThrow(
      ServiceUnavailableException
    )
  })
})

describe('MomoCallbackVerifier', () => {
  const verifier = new MomoCallbackVerifier(testConfigService() as never)
  const expected = { txRef: 'MOMO-abc', amount: 2_000_000 }

  function signedIpn(
    overrides: Record<string, string | number> = {}
  ): Record<string, string | number> {
    const fields: Record<string, string | number> = {
      partnerCode: momo.partnerCode,
      orderId: 'MOMO-abc',
      requestId: 'req-1',
      amount: 2_000_000,
      orderInfo: 'Rent 2026-10',
      orderType: 'momo_wallet',
      transId: 4088878653,
      resultCode: 0,
      message: 'Successful.',
      payType: 'qr',
      responseTime: 1730000000000,
      extraData: '',
      ...overrides,
    }
    const raw =
      `accessKey=${momo.accessKey}` +
      [
        'amount',
        'extraData',
        'message',
        'orderId',
        'orderInfo',
        'orderType',
        'partnerCode',
        'payType',
        'requestId',
        'responseTime',
        'resultCode',
        'transId',
      ]
        .map(key => `&${key}=${String(fields[key])}`)
        .join('')
    return {
      ...fields,
      signature: createHmac('sha256', momo.secretKey).update(raw).digest('hex'),
    }
  }

  function reasonOf(payload: unknown): string | null {
    try {
      verifier.verify(payload, 'notify', expected)
      return null
    } catch (error) {
      return error instanceof GatewayVerificationError ? error.reason : 'other'
    }
  }

  it('accepts a signed successful IPN body', () => {
    expect(verifier.verify(signedIpn(), 'notify', expected)).toEqual({
      txRef: 'MOMO-abc',
      amount: 2_000_000,
      succeeded: true,
      providerTransactionId: '4088878653',
    })
  })

  it('accepts the same fields as string query values on the browser return', () => {
    const query = Object.fromEntries(
      Object.entries(signedIpn()).map(([key, value]) => [key, String(value)])
    )
    expect(verifier.verify(query, 'return', expected).succeeded).toBe(true)
  })

  it('reports a signed non-zero resultCode as unsucceeded', () => {
    expect(
      verifier.verify(signedIpn({ resultCode: 1006 }), 'notify', expected)
        .succeeded
    ).toBe(false)
  })

  it.each([
    ['invalid-signature', { ...signedIpn(), amount: 1 }],
    ['merchant-mismatch', signedIpn({ partnerCode: 'OTHER' })],
    ['unknown-reference', signedIpn({ orderId: 'MOMO-other' })],
    ['amount-mismatch', signedIpn({ amount: 2_000_001 })],
    ['invalid-payload', { orderId: 'MOMO-abc' }],
  ])('rejects %s', (reason, payload) => {
    expect(reasonOf(payload)).toBe(reason)
  })
})
