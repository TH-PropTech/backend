import { ObjectId } from 'mongodb'
import { WalletsService } from './wallets.service'

const USER = new ObjectId().toHexString()
const OTHER_USER = new ObjectId().toHexString()
const LINK = {
  bankCode: 'VCB',
  accountNumber: '0123456789',
  accountHolder: 'Nguyễn Văn A',
}

type Doc = Record<string, unknown>

function setup(options: { fullName?: string; wallet?: Doc | null } = {}): {
  service: WalletsService
  wallets: Record<
    'findOne' | 'create' | 'save' | 'findOneAndUpdate' | 'updateOne',
    jest.Mock
  >
  payments: Record<'find', jest.Mock>
  payouts: Record<'find', jest.Mock>
} {
  const wallets = {
    findOne: jest.fn().mockResolvedValue(options.wallet ?? null),
    create: jest.fn((value: Doc) => ({ _id: new ObjectId(), ...value })),
    save: jest.fn((value: Doc) => Promise.resolve(value)),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  }
  const users = {
    findOne: jest
      .fn()
      .mockResolvedValue({ fullName: options.fullName ?? 'Nguyen Van A' }),
  }
  const payments = { find: jest.fn().mockResolvedValue([]) }
  const payouts = { find: jest.fn().mockResolvedValue([]) }
  const service = new WalletsService(
    wallets as never,
    users as never,
    payments as never,
    payouts as never
  )
  return { service, wallets, payments, payouts }
}

describe('WalletsService.link', () => {
  it('creates a wallet with a masked account and no balance fields in the response', async () => {
    const { service, wallets } = setup()

    const { wallet, newlyLinked } = await service.link(USER, LINK)

    expect(newlyLinked).toBe(true)
    expect(wallet).toEqual(
      expect.objectContaining({
        status: 'linked',
        bank: { code: 'VCB', name: 'Vietcombank' },
        accountHolder: 'NGUYEN VAN A',
        accountNumberMasked: '****6789',
      })
    )
    expect(wallet).not.toHaveProperty('balance')
    expect(wallet).not.toHaveProperty('totalReceived')
    expect(wallet).not.toHaveProperty('totalFeesPaid')
    expect(JSON.stringify(wallets.save.mock.calls)).not.toContain('0123456789')
  })

  it('re-links to a new bank account and updates the bank fields', async () => {
    const existing = {
      _id: new ObjectId(),
      userId: USER,
      status: 'linked',
      simulation: true,
      bankCode: 'VCB',
      bankName: 'Vietcombank',
      accountHolder: 'NGUYEN VAN A',
      accountNumberMasked: '****6789',
      linkedAt: new Date('2026-01-01'),
    }
    const { service, wallets } = setup({ wallet: existing })

    const { wallet, newlyLinked } = await service.link(USER, {
      ...LINK,
      bankCode: 'TCB',
      accountNumber: '9999999999',
    })

    expect(newlyLinked).toBe(false)
    expect(wallet.bank?.code).toBe('TCB')
    expect(wallet.accountNumberMasked).toBe('****9999')
    expect(wallet.linkedAt).toEqual(existing.linkedAt)
    expect(wallet).not.toHaveProperty('balance')
    expect(wallets.save).toHaveBeenCalledWith(
      expect.objectContaining({ bankCode: 'TCB', status: 'linked' })
    )
  })

  it('rejects an unknown bank and a holder name that differs from the profile', async () => {
    const { service } = setup()
    await expect(
      service.link(USER, { ...LINK, bankCode: 'XXX' })
    ).rejects.toThrow('WALLET_BANK_NOT_SUPPORTED')
    await expect(
      service.link(USER, { ...LINK, accountHolder: 'Tran Thi B' })
    ).rejects.toThrow('WALLET_HOLDER_NAME_MISMATCH')
  })

  it('matches the holder ignoring accents, case and extra spaces', async () => {
    const { service } = setup({ fullName: 'Nguyễn  Văn   Đạt' })
    await expect(
      service.link(USER, { ...LINK, accountHolder: 'nguyen van dat' })
    ).resolves.toEqual(expect.objectContaining({ newlyLinked: true }))
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
        simulation: true,
        bankCode: 'VCB',
        bankName: 'Vietcombank',
        accountHolder: 'NGUYEN VAN A',
        accountNumberMasked: '****6789',
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
