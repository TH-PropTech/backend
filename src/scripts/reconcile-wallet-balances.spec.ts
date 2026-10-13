import { reconcileWalletBalances } from './reconcile-wallet-balances'
import type { Wallet } from '../modules/wallets/schemas/wallet.schema'

/**
 * Entity `Wallet` không còn khai báo `balance`/`totalReceived`/
 * `totalFeesPaid` (xóa ở Nhóm 4, task 4.2), nhưng document Mongo cũ trong
 * `mock_bank_wallets` có thể còn các trường này — `reconcileWalletBalances`
 * đọc chúng qua kiểu thô, nên test giả lập cũng cần thêm các trường này
 * ngoài kiểu `Wallet` hiện tại.
 */
type LegacyWalletDoc = Wallet & {
  balance?: number
  totalReceived?: number
  totalFeesPaid?: number
}

function makeWallet(overrides: Partial<LegacyWalletDoc>): LegacyWalletDoc {
  return {
    userId: 'u1',
    provider: 'mock-bank',
    externalAccountRef: 'mock-account:u1',
    status: 'linked',
    simulation: true,
    bankCode: null,
    bankName: null,
    accountHolder: null,
    accountNumberMasked: null,
    balance: 0,
    totalReceived: 0,
    totalFeesPaid: 0,
    linkedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LegacyWalletDoc
}

describe('reconcileWalletBalances', () => {
  it('chỉ gọi find trên repository, không gọi save/update/delete', async () => {
    const find = jest.fn().mockResolvedValue([])
    const save = jest.fn()
    const update = jest.fn()
    const deleteFn = jest.fn()
    const repository = {
      find,
      save,
      update,
      delete: deleteFn,
    }

    await reconcileWalletBalances(repository)

    expect(find).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('lọc truy vấn theo balance > 0 (uỷ cho query, không tự lọc lại trong bộ nhớ sai)', async () => {
    const find = jest.fn().mockResolvedValue([])
    await reconcileWalletBalances({ find })
    expect(find).toHaveBeenCalledWith({
      where: { balance: { $gt: 0 } },
    })
  })

  it('tính đúng tổng số dư và số lượng ví từ kết quả trả về', async () => {
    const wallets: LegacyWalletDoc[] = [
      makeWallet({
        userId: 'u1',
        balance: 1000,
        totalReceived: 1500,
        totalFeesPaid: 500,
      }),
      makeWallet({
        userId: 'u2',
        balance: 250,
        totalReceived: 250,
        totalFeesPaid: 0,
      }),
    ]
    const find = jest.fn().mockResolvedValue(wallets)

    const result = await reconcileWalletBalances({ find })

    expect(result.count).toBe(2)
    expect(result.totalBalance).toBe(1250)
    expect(result.rows).toEqual([
      { userId: 'u1', balance: 1000, totalReceived: 1500, totalFeesPaid: 500 },
      { userId: 'u2', balance: 250, totalReceived: 250, totalFeesPaid: 0 },
    ])
  })

  it('trả về rỗng và tổng 0 khi không có ví nào có balance > 0', async () => {
    const find = jest.fn().mockResolvedValue([])
    const result = await reconcileWalletBalances({ find })
    expect(result.count).toBe(0)
    expect(result.totalBalance).toBe(0)
    expect(result.rows).toEqual([])
  })
})
