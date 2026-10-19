import { ServiceUnavailableException } from '@nestjs/common'
import { createHmac } from 'node:crypto'
import { ZalopayAdapter } from './zalopay.adapter'
import { ZalopayCallbackVerifier } from './zalopay-callback.verifier'
import { GatewayVerificationError } from './payment-provider.port'
import {
  jsonFetcher,
  TEST_PAYMENTS,
  testConfigService,
} from './gateway-test.util'

const zalo = TEST_PAYMENTS.zalopay
const hmac = (key: string, data: string): string =>
  createHmac('sha256', key).update(data).digest('hex')

describe('ZalopayAdapter', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('prefixes app_trans_id with the Vietnam date, even late in the UTC day', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T23:30:00.000Z'))
    const adapter = new ZalopayAdapter(testConfigService() as never)

    expect(adapter.newTxRef()).toMatch(/^261004_[a-f0-9]{24}$/)
  })

  it('posts a form-encoded order with the key1 MAC and returns order_url', async () => {
    const fetcher = jsonFetcher({
      return_code: 1,
      order_url: 'https://qcgateway.zalopay.vn/openinapp?order=abc',
    })
    const adapter = new ZalopayAdapter(testConfigService() as never, fetcher)

    const intent = await adapter.createPaymentIntent({
      amount: 3_000_000,
      description: 'Deposit DP-9',
      customerRef: 'tenant-1',
      txRef: '261003_abc',
      expiresAt: new Date(Date.now() + 15 * 60_000),
    })

    expect(intent.redirectUrl).toBe(
      'https://qcgateway.zalopay.vn/openinapp?order=abc'
    )
    const [url, init] = fetcher.mock.calls[0] as [string, { body: string }]
    expect(url).toBe(zalo.endpoint)
    const form = Object.fromEntries(new URLSearchParams(init.body))
    expect(form).toMatchObject({
      app_id: zalo.appId,
      app_trans_id: '261003_abc',
      amount: '3000000',
      callback_url: zalo.callbackUrl,
      embed_data: JSON.stringify({ redirecturl: zalo.returnUrl }),
    })
    expect(form.app_user).not.toContain('tenant-1')
    expect(form.mac).toBe(
      hmac(
        zalo.key1,
        [
          form.app_id,
          form.app_trans_id,
          form.app_user,
          form.amount,
          form.app_time,
          form.embed_data,
          form.item,
        ].join('|')
      )
    )
  })

  it.each([
    [undefined, ''],
    ['all', ''],
    ['card', 'CC'],
  ] as const)(
    'sends bank_code for zalopayMethod %s',
    async (method, bankCode) => {
      const fetcher = jsonFetcher({
        return_code: 1,
        order_url: 'https://qcgateway.zalopay.vn/openinapp?order=abc',
      })
      const adapter = new ZalopayAdapter(testConfigService() as never, fetcher)

      await adapter.createPaymentIntent({
        amount: 3_000_000,
        description: 'Deposit DP-9',
        customerRef: 'tenant-1',
        txRef: '261003_abc',
        expiresAt: new Date(Date.now() + 15 * 60_000),
        zalopayMethod: method,
      })

      const [, init] = fetcher.mock.calls[0] as [string, { body: string }]
      expect(new URLSearchParams(init.body).get('bank_code')).toBe(bankCode)
    }
  )

  it('fails closed when ZaloPay rejects the order', async () => {
    const adapter = new ZalopayAdapter(
      testConfigService() as never,
      jsonFetcher({ return_code: 2, return_message: 'Giao dịch thất bại' })
    )

    await expect(
      adapter.createPaymentIntent({
        amount: 1,
        description: 'x',
        customerRef: 'tenant-1',
        txRef: '261003_x',
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).rejects.toThrow(ServiceUnavailableException)
  })
})

describe('ZalopayCallbackVerifier', () => {
  const verifier = new ZalopayCallbackVerifier(testConfigService() as never)
  const expected = { txRef: '261003_abc', amount: 3_000_000 }

  function signedCallback(
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    const data = JSON.stringify({
      app_id: Number(zalo.appId),
      app_trans_id: '261003_abc',
      amount: 3_000_000,
      zp_trans_id: 240000123,
      ...overrides,
    })
    return { data, mac: hmac(zalo.key2, data), type: 1 }
  }

  function signedReturn(
    overrides: Record<string, string> = {}
  ): Record<string, string> {
    const query: Record<string, string> = {
      appid: zalo.appId,
      apptransid: '261003_abc',
      pmcid: '38',
      bankcode: '',
      amount: '3000000',
      discountamount: '0',
      status: '1',
      ...overrides,
    }
    const signed = [
      'appid',
      'apptransid',
      'pmcid',
      'bankcode',
      'amount',
      'discountamount',
      'status',
    ]
      .map(key => query[key])
      .join('|')
    return { ...query, checksum: hmac(zalo.key2, signed) }
  }

  function reasonOf(
    payload: unknown,
    kind: 'notify' | 'return'
  ): string | null {
    try {
      verifier.verify(payload, kind, expected)
      return null
    } catch (error) {
      return error instanceof GatewayVerificationError ? error.reason : 'other'
    }
  }

  it('accepts a key2-signed callback and returns zp_trans_id', () => {
    expect(verifier.verify(signedCallback(), 'notify', expected)).toEqual({
      txRef: '261003_abc',
      amount: 3_000_000,
      succeeded: true,
      providerTransactionId: '240000123',
    })
    expect(verifier.extractTxRef(signedCallback(), 'notify')).toBe('261003_abc')
  })

  it('accepts a checksum-signed browser return and maps status', () => {
    expect(verifier.verify(signedReturn(), 'return', expected).succeeded).toBe(
      true
    )
    expect(
      verifier.verify(signedReturn({ status: '-49' }), 'return', expected)
        .succeeded
    ).toBe(false)
    expect(verifier.extractTxRef(signedReturn(), 'return')).toBe('261003_abc')
  })

  it.each([
    ['invalid-signature', { ...signedCallback(), mac: 'deadbeef' }],
    ['merchant-mismatch', signedCallback({ app_id: 9999 })],
    ['unknown-reference', signedCallback({ app_trans_id: '261003_zzz' })],
    ['amount-mismatch', signedCallback({ amount: 1 })],
    ['invalid-payload', { mac: 'x' }],
  ])('rejects callback with %s', (reason, payload) => {
    expect(reasonOf(payload, 'notify')).toBe(reason)
  })

  it.each([
    ['invalid-signature', { ...signedReturn(), amount: '1' }],
    ['amount-mismatch', signedReturn({ amount: '1' })],
    ['invalid-payload', { apptransid: '261003_abc' }],
  ])('rejects return with %s', (reason, payload) => {
    expect(reasonOf(payload, 'return')).toBe(reason)
  })
})
