import { createHmac } from 'node:crypto'
import { MomoAdapter } from './momo.adapter'
import { VnpayAdapter } from './vnpay.adapter'
import { ZalopayAdapter } from './zalopay.adapter'
import {
  jsonFetcher,
  TEST_PAYMENTS,
  TEST_SECRETS,
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

describe('VnpayAdapter.queryStatus', () => {
  const vnpay = TEST_PAYMENTS.vnpay
  const make = (fetcher: jest.Mock): VnpayAdapter =>
    new VnpayAdapter(testConfigService() as never, fetcher)

  const signedReply = (
    fields: Record<string, string>
  ): Record<string, string> => {
    const field = (key: string): string => fields[key] ?? ''
    const data = [
      'vnp_ResponseId',
      'vnp_Command',
      'vnp_ResponseCode',
      'vnp_Message',
    ]
      .map(field)
      .concat(vnpay.tmnCode)
      .concat(
        [
          'vnp_TxnRef',
          'vnp_Amount',
          'vnp_BankCode',
          'vnp_PayDate',
          'vnp_TransactionNo',
          'vnp_TransactionType',
          'vnp_TransactionStatus',
          'vnp_OrderInfo',
          'vnp_PromotionCode',
          'vnp_PromotionAmount',
        ].map(field)
      )
      .join('|')
    return { ...fields, vnp_SecureHash: hmac('sha512', vnpay.hashSecret, data) }
  }
  const reply = (extra: Record<string, string>): Record<string, string> =>
    signedReply({
      vnp_ResponseId: 'r1',
      vnp_Command: 'querydr',
      vnp_ResponseCode: '00',
      vnp_Message: 'QueryDR Success',
      vnp_TxnRef: 'TX-1',
      vnp_Amount: '300000000',
      vnp_TransactionNo: '14000001',
      vnp_TransactionStatus: '00',
      ...extra,
    })

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T09:00:00.000Z'))
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('sends the pipe-joined SHA512 signed querydr body (GMT+7 dates)', async () => {
    const fetcher = jsonFetcher(reply({}))
    const result = await make(fetcher).queryStatus(query)

    const [url, init] = fetcher.mock.calls[0] as [string, { body: string }]
    expect(url).toBe(vnpay.queryEndpoint)
    const body = JSON.parse(init.body) as Record<string, string>
    expect(body).toMatchObject({
      vnp_Version: '2.1.0',
      vnp_Command: 'querydr',
      vnp_TmnCode: vnpay.tmnCode,
      vnp_TxnRef: 'TX-1',
      vnp_TransactionDate: '20261003150000',
      vnp_CreateDate: '20261003160000',
    })
    expect(body.vnp_SecureHash).toBe(
      hmac(
        'sha512',
        vnpay.hashSecret,
        [
          body.vnp_RequestId,
          body.vnp_Version,
          body.vnp_Command,
          body.vnp_TmnCode,
          body.vnp_TxnRef,
          body.vnp_TransactionDate,
          body.vnp_CreateDate,
          body.vnp_IpAddr,
          body.vnp_OrderInfo,
        ].join('|')
      )
    )
    expect(result).toMatchObject({
      state: 'succeeded',
      amount: 3_000_000,
      providerTransactionId: '14000001',
      rawCode: '00/00',
    })
  })

  it('maps pending, failed and not found', async () => {
    expect(
      (
        await make(
          jsonFetcher(reply({ vnp_TransactionStatus: '01' }))
        ).queryStatus(query)
      ).state
    ).toBe('pending')
    expect(
      (
        await make(
          jsonFetcher(reply({ vnp_TransactionStatus: '02' }))
        ).queryStatus(query)
      ).state
    ).toBe('failed')
    expect(
      (
        await make(
          jsonFetcher(
            reply({
              vnp_ResponseCode: '91',
              vnp_Message: 'Not found',
              vnp_TransactionStatus: '',
              vnp_Amount: '',
            })
          )
        ).queryStatus(query)
      ).state
    ).toBe('not_found')
  })

  it('is unavailable on a bad response signature, rejected merchant, and transport errors', async () => {
    const forged = { ...reply({}), vnp_Amount: '100' }
    expect((await make(jsonFetcher(forged)).queryStatus(query)).state).toBe(
      'unavailable'
    )
    const rejected = await make(
      jsonFetcher({
        vnp_ResponseCode: '02',
        vnp_Message: 'Website not approved',
      })
    ).queryStatus(query)
    expect(rejected).toMatchObject({ state: 'unavailable', rawCode: '02' })
    expect((await make(failingFetcher()).queryStatus(query)).state).toBe(
      'unavailable'
    )
    expect((await make(jsonFetcher(null)).queryStatus(query)).state).toBe(
      'unavailable'
    )
  })

  it('never echoes configured secrets in results', async () => {
    const results = await Promise.all([
      make(failingFetcher()).queryStatus(query),
      make(jsonFetcher({ vnp_ResponseCode: '99' })).queryStatus(query),
    ])
    for (const secret of TEST_SECRETS) {
      expect(JSON.stringify(results)).not.toContain(secret)
    }
  })
})
