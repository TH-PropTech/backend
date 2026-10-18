import { ObjectId } from 'mongodb'
import { MocbankEscrowError } from './mocbank-escrow.client'
import { WalletsService } from './wallets.service'

const USER = new ObjectId().toHexString()
const OTHER_USER = new ObjectId().toHexString()
const ACCOUNT_NUMBER = '810000000002'
const LINK = { accountNumber: ACCOUNT_NUMBER }

type Doc = Record<string, unknown>

function setup(
  options: {
    fullName?: string
    wallet?: Doc | null
    resolvedHolder?: string
    resolveError?: Error
  } = {}
): {
  service: WalletsService
  wallets: Record<
    'findOne' | 'find' | 'create' | 'save' | 'findOneAndUpdate' | 'updateOne',
    jest.Mock
  >
  users: Record<'findOne' | 'find', jest.Mock>
  payments: Record<'find', jest.Mock>
  payouts: Record<'find', jest.Mock>
  apartments: Record<'aggregate', jest.Mock>
  mocbank: Record<'resolveAccountHolder', jest.Mock>
} {
  const wallets = {
    findOne: jest.fn().mockResolvedValue(options.wallet ?? null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((value: Doc) => ({ _id: new ObjectId(), ...value })),
    save: jest.fn((value: Doc) => Promise.resolve(value)),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  }
  const users = {
    findOne: jest
      .fn()
      .mockResolvedValue({ fullName: options.fullName ?? 'Nguyen Van A' }),
    find: jest.fn().mockResolvedValue([]),
  }
  const payments = { find: jest.fn().mockResolvedValue([]) }
  const payouts = { find: jest.fn().mockResolvedValue([]) }
  const apartments = {
    aggregate: jest.fn((): { toArray: () => Promise<unknown[]> } => ({
      toArray: () => Promise.resolve([]),
    })),
  }
  const mocbank = {
    resolveAccountHolder: options.resolveError
      ? jest.fn().mockRejectedValue(options.resolveError)
      : jest.fn().mockResolvedValue(options.resolvedHolder ?? 'Nguyen Van A'),
  }
  const service = new WalletsService(
    wallets as never,
    users as never,
    payments as never,
    payouts as never,
    apartments as never,
    mocbank as never
  )
  return { service, wallets, users, payments, payouts, apartments, mocbank }
}

describe('WalletsService.link', () => {
  it('resolves the Ví Mộc account holder and links the wallet', async () => {
    const { service, mocbank } = setup()

    const { wallet, newlyLinked } = await service.link(USER, LINK)

    expect(mocbank.resolveAccountHolder).toHaveBeenCalledWith(ACCOUNT_NUMBER)
    expect(newlyLinked).toBe(true)
    expect(wallet).toEqual(
      expect.objectContaining({
        status: 'linked',
        bank: { code: 'MOCBANK', name: 'Ví Mộc' },
        accountHolder: 'NGUYEN VAN A',
        accountNumberMasked: '****0002',
        // Full number is included for the owner's own QR/receive display.
        accountNumber: ACCOUNT_NUMBER,
      })
    )
    expect(wallet).not.toHaveProperty('balance')
    expect(wallet).not.toHaveProperty('totalReceived')
    expect(wallet).not.toHaveProperty('totalFeesPaid')
  })

  it('re-links to a new Ví Mộc account and updates the fields', async () => {
    const existing = {
      _id: new ObjectId(),
      userId: USER,
      status: 'linked',
      simulation: false,
      provider: 'mocbank',
      bankCode: 'MOCBANK',
      bankName: 'Ví Mộc',
      accountHolder: 'NGUYEN VAN A',
      accountNumberMasked: '****0002',
      mocbankAccountNumber: ACCOUNT_NUMBER,
      linkedAt: new Date('2026-01-01'),
    }
    const { service, wallets } = setup({ wallet: existing })

    const { wallet, newlyLinked } = await service.link(USER, {
      accountNumber: '810000009999',
    })

    expect(newlyLinked).toBe(false)
    expect(wallet.accountNumberMasked).toBe('****9999')
    expect(wallet.linkedAt).toEqual(existing.linkedAt)
    expect(wallet).not.toHaveProperty('balance')
    expect(wallets.save).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'mocbank', status: 'linked' })
    )
  })

  it('rejects an account number Ví Mộc has no wallet for', async () => {
    const { service, wallets } = setup({
      resolveError: new MocbankEscrowError('WALLET_NOT_FOUND'),
    })
    await expect(service.link(USER, LINK)).rejects.toThrow('WALLET_NOT_FOUND')
    expect(wallets.save).not.toHaveBeenCalled()
  })

  it('rejects when Ví Mộc is unreachable instead of silently linking', async () => {
    const { service } = setup({
      resolveError: new MocbankEscrowError('GATEWAY_UNAVAILABLE'),
    })
    await expect(service.link(USER, LINK)).rejects.toThrow(
      'MOCBANK_UNAVAILABLE'
    )
  })

  it('links regardless of whether the resolved holder matches the profile name (receiving on behalf of someone is allowed)', async () => {
    const { service } = setup({ resolvedHolder: 'Tran Thi B' })
    await expect(service.link(USER, LINK)).resolves.toEqual(
      expect.objectContaining({ newlyLinked: true })
    )
  })
})

describe('WalletsService.listLandlordWallets', () => {
  it('lists users who own an apartment and never includes the full account number', async () => {
    const { service, wallets, users, apartments } = setup()
    apartments.aggregate
      .mockReturnValueOnce({ toArray: () => Promise.resolve([{ n: 1 }]) })
      .mockReturnValueOnce({
        toArray: () => Promise.resolve([{ _id: USER }]),
      })
    users.find.mockResolvedValue([
      { _id: new ObjectId(USER), fullName: 'Thạch chủ nhà', email: 'a@b.c' },
    ])
    wallets.find.mockResolvedValue([
      {
        userId: USER,
        status: 'linked',
        provider: 'mocbank',
        simulation: false,
        bankCode: 'MOCBANK',
        mocbankAccountNumber: ACCOUNT_NUMBER,
        accountNumberMasked: '****0002',
      },
    ])

    const page = await service.listLandlordWallets(1, 20)

    expect(page.total).toBe(1)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.wallet.accountNumberMasked).toBe('****0002')
    expect(page.items[0]?.wallet.accountNumber).toBeNull()
  })
})

describe('WalletsService.getMine', () => {
  it('returns an unlinked view instead of auto-linking, with no balance fields', async () => {
    const { service, wallets } = setup()

    const view = await service.getMine(USER)

    expect(view.status).toBe('unlinked')
    expect(view).not.toHaveProperty('balance')
    expect(view).not.toHaveProperty('totalReceived')
    expect(view).not.toHaveProperty('totalFeesPaid')
    expect(wallets.save).not.toHaveBeenCalled()
  })

  it('returns a linked view with no balance fields', async () => {
    const { service } = setup({
      wallet: {
        _id: new ObjectId(),
        userId: USER,
        status: 'linked',
        simulation: false,
        provider: 'mocbank',
        bankCode: 'MOCBANK',
        bankName: 'Ví Mộc',
        accountHolder: 'NGUYEN VAN A',
        accountNumberMasked: '****0002',
        balance: 1_000_000,
        totalReceived: 1_000_000,
        totalFeesPaid: 0,
        linkedAt: new Date('2026-01-01'),
      },
    })

    const view = await service.getMine(USER)

    expect(view.status).toBe('linked')
    expect(Object.keys(view).sort()).toEqual(
      [
        'accountHolder',
        'accountNumber',
        'accountNumberMasked',
        'bank',
        'linkedAt',
        'simulation',
        'status',
        'userId',
      ].sort()
    )
  })
})

describe('WalletsService.listPayableInvoices', () => {
  it('lists unpaid/overdue platform-fee invoices for the landlord, ordered by due date', async () => {
    const { service, payments } = setup()
    payments.find.mockResolvedValue([
      {
        _id: new ObjectId(),
        contractId: 'c-1',
        amount: 500_000,
        vatAmount: 50_000,
        description: 'Hoa hồng tháng 1',
        dueDate: new Date('2026-02-01'),
        status: 'unpaid',
      },
    ])

    const invoices = await service.listPayableInvoices(USER)

    const [findArg] = payments.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ]
    expect(findArg.where).toMatchObject({
      type: 'platform-fee',
      payerId: USER,
      payerRole: 'landlord',
    })
    expect(invoices).toEqual([
      expect.objectContaining({
        contractId: 'c-1',
        amount: 500_000,
        vatAmount: 50_000,
        status: 'unpaid',
      }),
    ])
  })
})

describe('WalletsService.listTransactions (D5: dựng từ Payout + Payment)', () => {
  it('mixes paid-out payouts and paid platform-fee invoices of the user, sorted by time descending, without balanceAfter', async () => {
    const { service, payouts, payments } = setup()
    const payout1 = {
      _id: new ObjectId(),
      landlordId: USER,
      contractId: 'c-1',
      receivedAmount: 4_000_000,
      status: 'paid-out',
      paidOutAt: new Date('2026-01-10T00:00:00Z'),
    }
    const payout2 = {
      _id: new ObjectId(),
      landlordId: USER,
      contractId: 'c-2',
      receivedAmount: 3_000_000,
      status: 'paid-out',
      paidOutAt: new Date('2026-01-05T00:00:00Z'),
    }
    const invoice = {
      _id: new ObjectId(),
      contractId: 'c-1',
      amount: 500_000,
      description: 'Hoa hồng tháng 1',
      status: 'paid',
      paidAt: new Date('2026-01-08T00:00:00Z'),
    }
    payouts.find.mockResolvedValue([payout1, payout2])
    payments.find.mockResolvedValue([invoice])

    const page = await service.listTransactions(USER, 1, 20)

    expect(page.items.map(item => item.type)).toEqual([
      'payout',
      'platform-fee',
      'payout',
    ])
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        type: 'payout',
        amount: 4_000_000,
        refType: 'payout',
        refId: payout1._id.toHexString(),
        contractId: 'c-1',
      })
    )
    expect(page.items[1]).toEqual(
      expect.objectContaining({
        type: 'platform-fee',
        amount: 500_000,
        refType: 'payment',
        refId: invoice._id.toHexString(),
        contractId: 'c-1',
        description: 'Hoa hồng tháng 1',
      })
    )
    for (const item of page.items) {
      expect(item).not.toHaveProperty('balanceAfter')
      expect(item.amount).toBeGreaterThan(0)
    }
    expect(page.total).toBe(3)
    expect(page.page).toBe(1)
    expect(page.limit).toBe(20)
    // Sao kê mới không còn repository `wallet_transactions` để đọc (D6);
    // WalletsService không còn inject entity này (xem task 4.2).

    const [payoutArg] = payouts.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ]
    expect(payoutArg.where).toMatchObject({
      landlordId: USER,
      status: 'paid-out',
    })
    const [paymentArg] = payments.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ]
    expect(paymentArg.where).toMatchObject({
      type: 'platform-fee',
      payerId: USER,
      payerRole: 'landlord',
      status: 'paid',
    })
  })

  it('paginates the merged list', async () => {
    const { service, payouts, payments } = setup()
    const makePayout = (day: number): Doc => ({
      _id: new ObjectId(),
      landlordId: USER,
      contractId: `c-${day}`,
      receivedAmount: 1000 * day,
      status: 'paid-out',
      paidOutAt: new Date(2026, 0, day),
    })
    payouts.find.mockResolvedValue([5, 4, 3, 2, 1].map(day => makePayout(day)))
    payments.find.mockResolvedValue([])

    const page1 = await service.listTransactions(USER, 1, 2)
    expect(page1.items).toHaveLength(2)
    expect(page1.items[0]?.contractId).toBe('c-5')
    expect(page1.items[1]?.contractId).toBe('c-4')
    expect(page1.total).toBe(5)

    const page2 = await service.listTransactions(USER, 2, 2)
    expect(page2.items).toHaveLength(2)
    expect(page2.items[0]?.contractId).toBe('c-3')
    expect(page2.items[1]?.contractId).toBe('c-2')
  })

  it('excludes payouts not paid-out and invoices not paid, via the query filters', async () => {
    const { service, payouts, payments } = setup()
    payouts.find.mockResolvedValue([])
    payments.find.mockResolvedValue([])

    const page = await service.listTransactions(USER, 1, 20)

    expect(page.items).toEqual([])
    const [payoutArg] = payouts.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ]
    expect(payoutArg.where.status).toBe('paid-out')
    const [paymentArg] = payments.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ]
    expect(paymentArg.where.status).toBe('paid')
  })

  it('only queries data scoped to the given userId', async () => {
    const { service, payouts, payments } = setup()
    payouts.find.mockResolvedValue([])
    payments.find.mockResolvedValue([])

    await service.listTransactions(OTHER_USER, 1, 20)

    const [payoutArg] = payouts.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ]
    expect(payoutArg.where.landlordId).toBe(OTHER_USER)
    const [paymentArg] = payments.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ]
    expect(paymentArg.where.payerId).toBe(OTHER_USER)
  })
})

describe('WalletsService Ví Mộc account (tiền chủ nhà nhận trực tiếp)', () => {
  it('links a Ví Mộc account and returns the full number only to its own owner', async () => {
    const { service, wallets } = setup()

    const { wallet, newlyLinked } = await service.link(USER, LINK)

    expect(newlyLinked).toBe(true)
    expect(wallets.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'mocbank',
        simulation: false,
        mocbankAccountNumber: ACCOUNT_NUMBER,
        externalAccountRef: `mocbank:${USER}`,
        accountNumberMasked: '****0002',
      })
    )
    expect(wallet).toMatchObject({
      simulation: false,
      bank: { code: 'MOCBANK', name: 'Ví Mộc' },
      accountNumberMasked: '****0002',
      accountNumber: ACCOUNT_NUMBER,
    })
  })

  it('returns the account only for a linked Ví Mộc wallet', async () => {
    const linked = setup({
      wallet: { userId: USER, mocbankAccountNumber: ACCOUNT_NUMBER },
    })
    await expect(linked.service.getMocbankAccountNumber(USER)).resolves.toBe(
      ACCOUNT_NUMBER
    )
    expect(linked.wallets.findOne).toHaveBeenCalledWith({
      where: { userId: USER, status: 'linked', provider: 'mocbank' },
    })

    const none = setup({ wallet: null })
    await expect(none.service.getMocbankAccountNumber(USER)).resolves.toBeNull()

    const otherBank = setup({
      wallet: { userId: USER, mocbankAccountNumber: null },
    })
    await expect(
      otherBank.service.getMocbankAccountNumber(USER)
    ).resolves.toBeNull()
  })
})
