import { createHmac } from 'node:crypto'
import { MomoAdapter } from './momo.adapter'
import { ZalopayAdapter } from './zalopay.adapter'
import {
  jsonFetcher,
  TEST_PAYMENTS,
  testConfigService,
} from './gateway-test.util'

const hmac = (algo: 'sha256' | 'sha512', key: string, data: string): string =>
  createHmac(algo, key).update(data).digest('hex')

const query = {
  txRef: 'TX-1',
  providerTransactionId: null,
  amount: 3_000_000,
  createdAt: new Date('2026-10-03T08:00:00.000Z'),
}

const failingFetcher = (): jest.Mock =>
  jest.fn().mockRejectedValue(new Error('ECONNRESET secret-leak'))

describe('ZalopayAdapter.queryStatus', () => {
  const zalo = TEST_PAYMENTS.zalopay
  const make = (fetcher: jest.Mock): ZalopayAdapter =>
    new ZalopayAdapter(testConfigService() as never, fetcher)

  it('posts a form with the key1 MAC to the query endpoint', async () => {
    const fetcher = jsonFetcher({
      return_code: 1,
      amount: 3_000_000,
      zp_trans_id: 240101000123,
    })
    const result = await make(fetcher).queryStatus(query)

    const [url, init] = fetcher.mock.calls[0] as [string, { body: string }]
    expect(url).toBe(zalo.queryEndpoint)
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      app_id: zalo.appId,
      app_trans_id: 'TX-1',
      mac: hmac('sha256', zalo.key1, `${zalo.appId}|TX-1|${zalo.key1}`),
    })
    expect(result).toMatchObject({
      state: 'succeeded',
      amount: 3_000_000,
      providerTransactionId: '240101000123',
      rawCode: '1',
    })
  })

  it('maps processing, failed, not found and unknown codes', async () => {
    expect(
      (await make(jsonFetcher({ return_code: 3 })).queryStatus(query)).state
    ).toBe('pending')
    expect(
      (
        await make(
          jsonFetcher({ return_code: 2, sub_return_code: -1 })
        ).queryStatus(query)
      ).state
    ).toBe('failed')
    const missing = await make(
      jsonFetcher({
        return_code: 2,
        sub_return_code: -101,
        sub_return_message: 'Đơn hàng không tồn tại',
      })
    ).queryStatus(query)
    expect(missing).toMatchObject({ state: 'not_found', rawCode: '2/-101' })
    expect(
      (await make(jsonFetcher({ return_code: 77 })).queryStatus(query)).state
    ).toBe('unavailable')
  })

  it('returns unavailable on network error, bad body and HTTP failure without leaking details', async () => {
    const logged = await make(failingFetcher()).queryStatus(query)
    expect(logged.state).toBe('unavailable')
    expect(JSON.stringify(logged)).not.toContain('secret-leak')
    expect((await make(jsonFetcher('oops')).queryStatus(query)).state).toBe(
      'unavailable'
    )
    expect((await make(jsonFetcher({}, false)).queryStatus(query)).state).toBe(
      'unavailable'
    )
  })
})

describe('MomoAdapter.queryStatus', () => {
  const momo = TEST_PAYMENTS.momo
  const make = (fetcher: jest.Mock): MomoAdapter =>
    new MomoAdapter(testConfigService() as never, fetcher)

  it('posts the documented signed JSON and maps resultCode 0', async () => {
    const fetcher = jsonFetcher({
      resultCode: 0,
      transId: 998877,
      amount: 5000,
    })
    const result = await make(fetcher).queryStatus(query)

    const [url, init] = fetcher.mock.calls[0] as [string, { body: string }]
    expect(url).toBe(momo.queryEndpoint)
    const body = JSON.parse(init.body) as Record<string, string>
    expect(body).toMatchObject({
      partnerCode: momo.partnerCode,
      orderId: 'TX-1',
      lang: 'vi',
    })
    expect(body.signature).toBe(
      hmac(
        'sha256',
        momo.secretKey,
        `accessKey=${momo.accessKey}&orderId=TX-1&partnerCode=${momo.partnerCode}&requestId=${body.requestId}`
      )
    )
    expect(result).toMatchObject({
      state: 'succeeded',
      providerTransactionId: '998877',
      amount: 5000,
      rawCode: '0',
    })
  })

  it.each([
    [1000, 'pending'],
    [7000, 'pending'],
    [7002, 'pending'],
    [9000, 'pending'],
    [1006, 'failed'],
    [1001, 'failed'],
    [1005, 'not_found'],
    [42, 'not_found'],
    [10, 'unavailable'],
  ])('maps resultCode %s to %s', async (resultCode, state) => {
    const result = await make(jsonFetcher({ resultCode })).queryStatus(query)
    expect(result.state).toBe(state)
  })

  it('returns unavailable on network error and malformed body', async () => {
    expect((await make(failingFetcher()).queryStatus(query)).state).toBe(
      'unavailable'
    )
    expect((await make(jsonFetcher({ x: 1 })).queryStatus(query)).state).toBe(
      'unavailable'
    )
    expect(
      (await make(jsonFetcher({ resultCode: '0' })).queryStatus(query)).state
    ).toBe('unavailable')
  })
})
