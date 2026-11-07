import { ObjectId } from 'mongodb'
import { MocbankAccountLookupError } from './mocbank-account-lookup.client'
import { WalletsService } from './wallets.service'

const USER = new ObjectId().toHexString()
const ACCOUNT_NUMBER = '810000000002'

type Doc = Record<string, unknown>

function setup(wallet: Doc | null): {
  service: WalletsService
  payouts: Record<'find', jest.Mock>
  mocbank: Record<'resolveAccount', jest.Mock>
} {
  const wallets = { findOne: jest.fn().mockResolvedValue(wallet) }
  const payouts = { find: jest.fn().mockResolvedValue([]) }
  const mocbank = {
    resolveAccount: jest
      .fn()
      .mockResolvedValue({ accountName: 'A', brand: 'mocbank' }),
  }
  const service = new WalletsService(
    wallets as never,
    {} as never,
    {} as never,
    payouts as never,
    {} as never,
    mocbank as never
  )
  return { service, payouts, mocbank }
}

const linkedWallet = (extra: Doc[] = []): Doc => ({
  _id: new ObjectId(),
  userId: USER,
  status: 'linked',
  provider: 'mocbank',
  mocbankAccountNumber: ACCOUNT_NUMBER,
  accountNumberMasked: '****0002',
  accountHolder: 'NGUYEN VAN A',
  extraAccounts: extra,
})
const extraMomo: Doc = {
  brand: 'momo',
  mocbankAccountNumber: '810000000003',
  accountNumberMasked: '****0003',
  accountHolder: 'NGUYEN VAN A',
}
const payout = (over: Doc): Doc => ({
  _id: new ObjectId(),
  contractId: 'c1',
  sentAmount: 1000,
  receivedAmount: 1000,
  failureReason: null,
  relayRef: null,
  txRef: null,
  paidOutAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...over,
})
const isPaidQuery = (opts: { where: { status: unknown } }): boolean =>
  opts.where.status === 'paid-out'

describe('WalletsService.getReceivingStatus', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('maps active, brand_mismatch, not_found and unreachable in order', async () => {
    const extras = [
      extraMomo,
      { ...extraMomo, brand: 'zalopay', mocbankAccountNumber: '4' },
      { ...extraMomo, brand: 'zalopay', mocbankAccountNumber: '5' },
    ]
    const { service, mocbank } = setup(linkedWallet(extras))
    mocbank.resolveAccount.mockImplementation((n: string) => {
      if (n === ACCOUNT_NUMBER)
        return Promise.resolve({ accountName: 'A', brand: 'mocbank' })
      if (n === '810000000003')
        return Promise.resolve({ accountName: 'A', brand: 'zalopay' })
      if (n === '4')
        return Promise.reject(new MocbankAccountLookupError('WALLET_NOT_FOUND'))
      return Promise.reject(new Error('boom'))
    })

    const result = await service.getReceivingStatus(USER)

    expect(result.hasLinkedWallet).toBe(true)
    expect(result.accounts.map(a => [a.brand, a.state])).toEqual([
      ['mocbank', 'active'],
      ['momo', 'brand_mismatch'],
      ['zalopay', 'not_found'],
      ['zalopay', 'unreachable'],
    ])
    expect(result.accounts[0]).toEqual(
      expect.objectContaining({
        accountNumberMasked: '****0002',
        message: 'Ví đang hoạt động',
      })
    )
    expect(result.accounts[3]?.message).toBe(
      'Không kết nối được tới Ví Mộc, thử lại sau'
    )
  })

  it('caches within TTL, refresh bypasses, and expires after 2 minutes', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-05-01T00:00:00Z'))
    const { service, mocbank } = setup(linkedWallet())

    await service.getReceivingStatus(USER)
    await service.getReceivingStatus(USER)
    expect(mocbank.resolveAccount).toHaveBeenCalledTimes(1)

    await service.getReceivingStatus(USER, true)
    expect(mocbank.resolveAccount).toHaveBeenCalledTimes(2)

    jest.setSystemTime(new Date('2026-05-01T00:01:59Z'))
    await service.getReceivingStatus(USER)
    expect(mocbank.resolveAccount).toHaveBeenCalledTimes(2)

    jest.setSystemTime(new Date('2026-05-01T00:02:01Z'))
    await service.getReceivingStatus(USER)
    expect(mocbank.resolveAccount).toHaveBeenCalledTimes(3)
  })

  it('never throws when a check hangs; times out as unreachable', async () => {
    jest.useFakeTimers()
    const { service, mocbank } = setup(linkedWallet())
    mocbank.resolveAccount.mockReturnValue(new Promise(() => undefined))

    const pending = service.getReceivingStatus(USER)
    await jest.advanceTimersByTimeAsync(4100)
    const result = await pending

    expect(result.accounts[0]?.state).toBe('unreachable')
  })

  it('returns counts, newest-first issues capped at 20, and lastReceived', async () => {
    const { service, payouts } = setup(linkedWallet())
    const statuses = ['failed', 'pending', 'awaiting-wallet']
    const problems = Array.from({ length: 25 }, (_, i) =>
      payout({
        status: statuses[i % 3],
        failureReason: i % 3 === 0 ? 'TRANSFER_FAILED' : null,
        createdAt: new Date(2026, 0, i + 1),
      })
    )
    payouts.find.mockImplementation((opts: { where: { status: unknown } }) =>
      Promise.resolve(
        isPaidQuery(opts)
          ? [
              payout({
                status: 'paid-out',
                receivedAmount: 900,
                relayRef: 'R1',
                txRef: 'T1',
                paidOutAt: new Date('2026-02-02'),
              }),
            ]
          : problems
      )
    )

    const result = await service.getReceivingStatus(USER)

    expect(result.counts).toEqual({ awaitingWallet: 8, pending: 8, failed: 9 })
    expect(result.issues).toHaveLength(20)
    expect(result.issues[0]?.createdAt).toBe(
      new Date(2026, 0, 25).toISOString()
    )
    expect(result.issues[0]?.reportedAt).toBeNull()
    const failed = result.issues.find(i => i.status === 'failed')
    expect(failed?.reasonCode).toBe('TRANSFER_FAILED')
    expect(failed?.reason).toEqual(expect.any(String))
    expect(result.lastReceived).toEqual({
      payoutId: result.lastReceived?.payoutId,
      contractId: 'c1',
      amount: 900,
      paidOutAt: '2026-02-02T00:00:00.000Z',
      reference: 'R1',
    })
  })

  it('falls back to txRef; lastReceived is null with no paid payout', async () => {
    const { service, payouts } = setup(linkedWallet())
    payouts.find.mockImplementation((opts: { where: { status: unknown } }) =>
      Promise.resolve(
        isPaidQuery(opts)
          ? [payout({ status: 'paid-out', txRef: 'T9', paidOutAt: new Date() })]
          : []
      )
    )
    const first = await service.getReceivingStatus(USER)
    expect(first.lastReceived?.reference).toBe('T9')

    payouts.find.mockResolvedValue([])
    const second = await service.getReceivingStatus(USER)
    expect(second.lastReceived).toBeNull()
  })

  it('lists issues without accounts when no wallet is linked', async () => {
    const { service, mocbank, payouts } = setup(null)
    payouts.find.mockImplementation((opts: { where: { status: unknown } }) =>
      Promise.resolve(
        isPaidQuery(opts) ? [] : [payout({ status: 'awaiting-wallet' })]
      )
    )

    const result = await service.getReceivingStatus(USER)

    expect(result.hasLinkedWallet).toBe(false)
    expect(result.accounts).toEqual([])
    expect(result.counts.awaitingWallet).toBe(1)
    expect(result.issues).toHaveLength(1)
    expect(mocbank.resolveAccount).not.toHaveBeenCalled()
  })
})
