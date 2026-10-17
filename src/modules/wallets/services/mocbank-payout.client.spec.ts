import { Logger } from '@nestjs/common'
import {
  jsonFetcher,
  TEST_PAYMENTS,
  testConfigService,
} from '../../mock-bank/providers/gateway-test.util'
import {
  MocbankPayoutClient,
  MocbankPayoutError,
} from './mocbank-payout.client'

const moc = TEST_PAYMENTS.mocbank
const input = {
  orderId: 'PAYOUT-abc',
  amount: 3_000_000,
  payeeAccountNumber: '810000000002',
  description: 'Chuyển hộ tiền thuê',
}

function okReply(overrides: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    data: {
      orderId: input.orderId,
      amount: input.amount,
      payeeAccountNumber: input.payeeAccountNumber,
      status: 'SUCCESS',
      transactionCode: 'TX_PAYOUT_1',
      ...overrides,
    },
  }
}

function httpFetcher(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  })
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error instanceof MocbankPayoutError ? error.code : error
  }
}

describe('MocbankPayoutClient', () => {
  const clientWith = (fetcher: jest.Mock): MocbankPayoutClient =>
    new MocbankPayoutClient(testConfigService() as never, fetcher)

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  it('posts the payout with merchant headers and returns the transaction code', async () => {
    const fetcher = jsonFetcher(okReply())

    await expect(clientWith(fetcher).payout(input)).resolves.toEqual({
      transactionCode: 'TX_PAYOUT_1',
    })

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${moc.baseUrl}/api/payouts`)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'X-Merchant-Id': moc.merchantId,
      'X-Merchant-Secret': moc.merchantSecret,
    })
    expect(JSON.parse(init.body as string)).toEqual(input)
  })

  it.each([
    ['another order', { orderId: 'PAYOUT-other' }],
    ['another amount', { amount: 1 }],
    ['another account', { payeeAccountNumber: '810000000099' }],
    ['a non-success status', { status: 'FAILED' }],
    ['no transaction code', { transactionCode: undefined }],
  ])('rejects a reply that confirms %s', async (_label, patch) => {
    const fetcher = jsonFetcher(okReply(patch))

    await expect(codeOf(clientWith(fetcher).payout(input))).resolves.toBe(
      'GATEWAY_UNAVAILABLE'
    )
  })

  it('surfaces a plain error code from Mộc Bank', async () => {
    const fetcher = httpFetcher(409, {
      success: false,
      error: { code: 'INSUFFICIENT_BALANCE', message: 'x' },
    })

    await expect(codeOf(clientWith(fetcher).payout(input))).resolves.toBe(
      'INSUFFICIENT_BALANCE'
    )
  })

  it('does not trust an error code that is not a plain token', async () => {
    const fetcher = httpFetcher(400, {
      success: false,
      error: { code: '<script>alert(1)</script>' },
    })

    await expect(codeOf(clientWith(fetcher).payout(input))).resolves.toBe(
      'GATEWAY_UNAVAILABLE'
    )
  })

  it.each([
    ['a network failure', jest.fn().mockRejectedValue(new Error('down'))],
    ['invalid JSON', httpFetcher(200, null)],
    ['a server error', httpFetcher(500, { success: false })],
  ])('fails closed on %s', async (_label, fetcher) => {
    await expect(codeOf(clientWith(fetcher).payout(input))).resolves.toBe(
      'GATEWAY_UNAVAILABLE'
    )
  })

  it('reports whether merchant credentials are configured', async () => {
    expect(clientWith(jest.fn()).isConfigured()).toBe(true)
    const missing = new MocbankPayoutClient(
      testConfigService({
        ...TEST_PAYMENTS,
        mocbank: { ...moc, merchantSecret: '' },
      }) as never,
      jest.fn()
    )
    expect(missing.isConfigured()).toBe(false)
    await expect(codeOf(missing.payout(input))).resolves.toBe('NOT_CONFIGURED')
  })
})
