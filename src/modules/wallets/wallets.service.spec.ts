import { ObjectId } from 'mongodb'
import { WalletsService } from './wallets.service'

const USER = new ObjectId().toHexString()
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
  transactions: Record<'findOne' | 'create' | 'save' | 'updateOne', jest.Mock>
} {
  const wallets = {
    findOne: jest.fn().mockResolvedValue(options.wallet ?? null),
    create: jest.fn((value: Doc) => ({ _id: new ObjectId(), ...value })),
    save: jest.fn((value: Doc) => Promise.resolve(value)),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  }
  const transactions = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value: Doc) => value),
    save: jest.fn((value: Doc) => Promise.resolve(value)),
    updateOne: jest.fn().mockResolvedValue({}),
  }
  const users = {
    findOne: jest
      .fn()
      .mockResolvedValue({ fullName: options.fullName ?? 'Nguyen Van A' }),
  }
  const service = new WalletsService(
    wallets as never,
    transactions as never,
    users as never,
    { find: jest.fn() } as never
  )
  return { service, wallets, transactions }
}

describe('WalletsService.link', () => {
  it('creates a wallet with masked account and zero balance', async () => {
    const { service, wallets } = setup()

    const { wallet, newlyLinked } = await service.link(USER, LINK)

    expect(newlyLinked).toBe(true)
    expect(wallet).toEqual(
      expect.objectContaining({
        status: 'linked',
        bank: { code: 'VCB', name: 'Vietcombank' },
        accountHolder: 'NGUYEN VAN A',
        accountNumberMasked: '****6789',
        balance: 0,
      })
    )
    expect(JSON.stringify(wallets.save.mock.calls)).not.toContain('0123456789')
  })

  it('keeps the balance when the bank account is changed', async () => {
    const existing = {
      _id: new ObjectId(),
      userId: USER,
      status: 'linked',
      simulation: true,
      balance: 7_000_000,
      linkedAt: new Date('2026-01-01'),
    }
    const { service } = setup({ wallet: existing })

    const { wallet, newlyLinked } = await service.link(USER, {
      ...LINK,
      bankCode: 'TCB',
    })

    expect(newlyLinked).toBe(false)
    expect(wallet.balance).toBe(7_000_000)
    expect(wallet.bank?.code).toBe('TCB')
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
  it('returns an unlinked empty view instead of auto-linking', async () => {
    const { service, wallets } = setup()

    const view = await service.getMine(USER)

    expect(view.status).toBe('unlinked')
    expect(view.balance).toBe(0)
    expect(wallets.save).not.toHaveBeenCalled()
  })
})

describe('WalletsService ledger', () => {
  const walletDoc = (balance: number): Doc => ({
    _id: new ObjectId(),
    userId: USER,
    status: 'linked',
    balance,
  })

  it('credits a payout, records the statement line and increments totals', async () => {
    const { service, wallets, transactions } = setup()
    wallets.findOneAndUpdate.mockResolvedValue(walletDoc(5_000_000))

    const tx = await service.creditPayout({
      userId: USER,
      payoutId: 'payout-1',
      amount: 5_000_000,
      contractId: 'c-1',
      paymentId: 'pay-1',
    })

    expect(wallets.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: USER, status: 'linked' },
      { $inc: { balance: 5_000_000, totalReceived: 5_000_000 } },
      { returnDocument: 'after' }
    )
    expect(tx).toEqual(
      expect.objectContaining({
        type: 'payout-credit',
        amount: 5_000_000,
        balanceAfter: 5_000_000,
        refType: 'payout',
        refId: 'payout-1',
      })
    )
    expect(transactions.save).toHaveBeenCalledTimes(1)
  })

  it('does not credit twice for the same payout', async () => {
    const { service, wallets, transactions } = setup()
    transactions.findOne.mockResolvedValue({ refId: 'payout-1' })

    await service.creditPayout({
      userId: USER,
      payoutId: 'payout-1',
      amount: 5_000_000,
      contractId: null,
      paymentId: 'pay-1',
    })

    expect(wallets.findOneAndUpdate).not.toHaveBeenCalled()
    expect(transactions.save).not.toHaveBeenCalled()
  })

  it('requires the balance to cover the invoice inside the same atomic update', async () => {
    const { service, wallets } = setup({ wallet: walletDoc(100) })
    wallets.findOneAndUpdate.mockResolvedValue(null)

    await expect(
      service.debitInvoice({
        userId: USER,
        paymentId: 'inv-1',
        amount: 1_100_000,
        contractId: 'c-1',
        description: 'Hoa hồng',
      })
    ).rejects.toThrow('WALLET_INSUFFICIENT_BALANCE')
    expect(wallets.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: USER, status: 'linked', balance: { $gte: 1_100_000 } },
      { $inc: { balance: -1_100_000, totalFeesPaid: 1_100_000 } },
      { returnDocument: 'after' }
    )
  })

  it('reports an unlinked wallet instead of an insufficient balance', async () => {
    const { service, wallets } = setup({ wallet: null })
    wallets.findOneAndUpdate.mockResolvedValue(null)

    await expect(
      service.debitInvoice({
        userId: USER,
        paymentId: 'inv-1',
        amount: 1000,
        contractId: null,
        description: 'x',
      })
    ).rejects.toThrow('WALLET_NOT_LINKED')
  })

  it('undoes the balance move when the statement line cannot be saved', async () => {
    const { service, wallets, transactions } = setup()
    wallets.findOneAndUpdate.mockResolvedValue(walletDoc(5_000_000))
    transactions.save.mockRejectedValueOnce(new Error('db down'))

    await expect(
      service.creditPayout({
        userId: USER,
        payoutId: 'payout-2',
        amount: 5_000_000,
        contractId: null,
        paymentId: 'pay-2',
      })
    ).rejects.toThrow('db down')

    expect(wallets.updateOne).toHaveBeenCalledWith(
      { userId: USER },
      { $inc: { balance: -5_000_000, totalReceived: -5_000_000 } }
    )
  })

  it('frees the invoice key on refund so a later retry can debit again', async () => {
    const { service, wallets, transactions } = setup()
    wallets.findOneAndUpdate.mockResolvedValue(walletDoc(1_100_000))

    await service.refundInvoice({
      userId: USER,
      paymentId: 'inv-1',
      amount: 1_100_000,
      contractId: 'c-1',
    })

    expect(transactions.updateOne).toHaveBeenCalledWith(
      { refType: 'platform-fee-invoice', refId: 'inv-1' },
      { $set: { refType: 'platform-fee-invoice-reversed' } }
    )
    expect(wallets.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: USER, status: 'linked' },
      { $inc: { balance: 1_100_000, totalFeesPaid: -1_100_000 } },
      { returnDocument: 'after' }
    )
  })

  it('rejects non-positive or fractional amounts', async () => {
    const { service } = setup()
    await expect(
      service.creditPayout({
        userId: USER,
        payoutId: 'p',
        amount: 0,
        contractId: null,
        paymentId: 'x',
      })
    ).rejects.toThrow('WALLET_AMOUNT_INVALID')
    await expect(
      service.debitInvoice({
        userId: USER,
        paymentId: 'p',
        amount: 10.5,
        contractId: null,
        description: 'x',
      })
    ).rejects.toThrow('WALLET_AMOUNT_INVALID')
  })
})
