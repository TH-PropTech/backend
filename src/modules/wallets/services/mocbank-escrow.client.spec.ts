import { Logger } from '@nestjs/common'
import {
  jsonFetcher,
  TEST_PAYMENTS,
  TEST_SECRETS,
  testConfigService,
} from '../../mock-bank/providers/gateway-test.util'
import {
  MocbankEscrowAlreadySettledError,
  MocbankEscrowClient,
  MocbankEscrowError,
} from './mocbank-escrow.client'

const moc = TEST_PAYMENTS.mocbank
const ESCROW_ID = 'ESC_1'
const REFUND_AT = '2027-01-14T00:00:00.000Z'

function escrowReply(overrides: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    data: {
      escrowId: ESCROW_ID,
      status: 'SETTLED',
      amount: 120_000_000,
      autoRefundAt: REFUND_AT,
      transactionCodes: ['TX_1'],
      autoRefundDue: false,
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

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

const settleInput = {
  settlementId: 'deposit:A1:release',
  reason: 'handover-completed',
  allocations: [{ party: 'PAYEE' as const, amount: 120_000_000 }],
}

describe('MocbankEscrowClient', () => {
  const clientWith = (fetcher: jest.Mock): MocbankEscrowClient =>
    new MocbankEscrowClient(testConfigService() as never, fetcher)
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined)
  })

  it('settles with merchant headers and returns status and transaction codes', async () => {
    const fetcher = jsonFetcher(escrowReply())

    const escrow = await clientWith(fetcher).settle(ESCROW_ID, settleInput)

    expect(escrow).toEqual({
      escrowId: ESCROW_ID,
      status: 'SETTLED',
      amount: 120_000_000,
      autoRefundAt: new Date(REFUND_AT),
      transactionCodes: ['TX_1'],
      autoRefundDue: false,
    })
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${moc.baseUrl}/api/escrows/${ESCROW_ID}/settle`)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'X-Merchant-Id': moc.merchantId,
      'X-Merchant-Secret': moc.merchantSecret,
    })
    expect(JSON.parse(init.body as string)).toEqual(settleInput)
  })

  it('reads an escrow with a GET and the merchant headers only', async () => {
    const fetcher = jsonFetcher(
      escrowReply({ status: 'HELD', transactionCodes: undefined })
    )

    const escrow = await clientWith(fetcher).get(ESCROW_ID)

    expect(escrow.status).toBe('HELD')
    expect(escrow.transactionCodes).toEqual([])
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${moc.baseUrl}/api/escrows/${ESCROW_ID}`)
    expect(init.method).toBe('GET')
    expect(init.headers).toEqual({
      'X-Merchant-Id': moc.merchantId,
      'X-Merchant-Secret': moc.merchantSecret,
    })
  })

  it('resolves account name and lower-cases the service brand', async () => {
    const fetcher = jsonFetcher({
      success: true,
      data: {
        accountNumber: '810000007777',
        accountName: 'A B',
        brand: 'MOMO',
      },
    })
    await expect(
      clientWith(fetcher).resolveAccount('810000007777')
    ).resolves.toEqual({ accountName: 'A B', brand: 'momo' })
    const [url] = fetcher.mock.calls[0] as [string]
    expect(url).toBe(`${moc.baseUrl}/api/wallets/resolve/810000007777`)
  })

  it('treats a missing or unknown brand as mocbank and keeps resolveAccountHolder returning the name', async () => {
    const missing = jsonFetcher({ success: true, data: { accountName: 'A B' } })
    await expect(
      clientWith(missing).resolveAccount('810000000002')
    ).resolves.toEqual({ accountName: 'A B', brand: 'mocbank' })
    const unknown = jsonFetcher({
      success: true,
      data: { accountName: 'A B', brand: 'PAYPAL' },
    })
    await expect(
      clientWith(unknown).resolveAccount('810000000002')
    ).resolves.toEqual({ accountName: 'A B', brand: 'mocbank' })
    const holder = jsonFetcher({
      success: true,
      data: { accountName: 'A B', brand: 'ZALOPAY' },
    })
    await expect(
      clientWith(holder).resolveAccountHolder('810000000002')
    ).resolves.toBe('A B')
  })

  it('extends with an ISO autoRefundAt', async () => {
    const fetcher = jsonFetcher(escrowReply({ status: 'HELD' }))

    await clientWith(fetcher).extend(ESCROW_ID, new Date(REFUND_AT))

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${moc.baseUrl}/api/escrows/${ESCROW_ID}/extend`)
    expect(JSON.parse(init.body as string)).toEqual({ autoRefundAt: REFUND_AT })
  })

  it('maps 409 ESCROW_ALREADY_SETTLED to a dedicated error', async () => {
    const fetcher = httpFetcher(409, {
      success: false,
      error: { code: 'ESCROW_ALREADY_SETTLED' },
    })

    const error = await failureOf(
      clientWith(fetcher).settle(ESCROW_ID, settleInput)
    )

    expect(error).toBeInstanceOf(MocbankEscrowAlreadySettledError)
    expect(error).toBeInstanceOf(MocbankEscrowError)
  })

  it.each([
    ['another escrow', { escrowId: 'ESC_other' }],
    ['no status', { status: undefined }],
    ['an unknown status', { status: 'WEIRD' }],
    ['a fractional amount', { amount: 1.5 }],
    ['no amount', { amount: undefined }],
    ['an invalid autoRefundAt', { autoRefundAt: 'not-a-date' }],
    ['non-string transaction codes', { transactionCodes: [1] }],
  ])('rejects a reply with %s', async (_label, patch) => {
    const fetcher = jsonFetcher(escrowReply(patch))

    const error = await failureOf(clientWith(fetcher).get(ESCROW_ID))

    expect(error).toMatchObject({ code: 'GATEWAY_UNAVAILABLE' })
  })

  it('surfaces a plain error code from Ví Mộc', async () => {
    const fetcher = httpFetcher(422, {
      success: false,
      error: { code: 'ALLOCATION_MISMATCH' },
    })

    const error = await failureOf(
      clientWith(fetcher).settle(ESCROW_ID, settleInput)
    )

    expect(error).toMatchObject({ code: 'ALLOCATION_MISMATCH' })
  })

  it('does not trust an error code that is not a plain token', async () => {
    const fetcher = httpFetcher(400, {
      success: false,
      error: { code: '<script>alert(1)</script>' },
    })

    const error = await failureOf(clientWith(fetcher).get(ESCROW_ID))

    expect(error).toMatchObject({ code: 'GATEWAY_UNAVAILABLE' })
  })

  it.each([
    ['a network failure', jest.fn().mockRejectedValue(new Error('down'))],
    ['invalid JSON', httpFetcher(200, null)],
    ['a server error', httpFetcher(503, { success: false })],
    ['success false', httpFetcher(200, { success: false })],
  ])('fails closed on %s and logs no secret', async (_label, fetcher) => {
    const error = await failureOf(clientWith(fetcher).get(ESCROW_ID))

    expect(error).toMatchObject({ code: 'GATEWAY_UNAVAILABLE' })
    const logged = JSON.stringify(warn.mock.calls)
    for (const secret of TEST_SECRETS) expect(logged).not.toContain(secret)
  })

  it('refuses to call Ví Mộc when merchant credentials are missing', async () => {
    const fetcher = jest.fn()
    const client = new MocbankEscrowClient(
      testConfigService({
        ...TEST_PAYMENTS,
        mocbank: { ...moc, merchantSecret: '' },
      }) as never,
      fetcher
    )

    const error = await failureOf(client.get(ESCROW_ID))

    expect(error).toMatchObject({ code: 'NOT_CONFIGURED' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
