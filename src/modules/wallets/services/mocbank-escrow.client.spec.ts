import { Logger } from '@nestjs/common'
import {
  jsonFetcher,
  TEST_PAYMENTS,
  testConfigService,
} from '../../mock-bank/providers/gateway-test.util'
import { MocbankEscrowClient } from './mocbank-escrow.client'

const moc = TEST_PAYMENTS.mocbank

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

describe('MocbankEscrowClient (account lookups)', () => {
  const clientWith = (fetcher: jest.Mock): MocbankEscrowClient =>
    new MocbankEscrowClient(testConfigService() as never, fetcher)

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
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

  it('maps an unknown account to WALLET_NOT_FOUND', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: jest.fn().mockResolvedValue({ success: false }),
    })

    const error = await failureOf(clientWith(fetcher).resolveAccount('1'))

    expect(error).toMatchObject({ code: 'WALLET_NOT_FOUND' })
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

    const error = await failureOf(client.resolveAccount('810000000002'))

    expect(error).toMatchObject({ code: 'NOT_CONFIGURED' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
