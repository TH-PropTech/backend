import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { PayoutsService } from './payouts.service'
import type { Payout } from '../schemas/payout.schema'

const LANDLORD = 'landlord-1'
const walletId = new ObjectId()

function makePayout(overrides: Partial<Payout> = {}): Payout {
  return {
    _id: new ObjectId(),
    paymentId: 'pay-1',
    contractId: 'c-1',
    landlordId: LANDLORD,
    walletId: walletId.toHexString(),
    txRef: 'PAYOUT-1',
    sentAmount: 5_000_000,
    feeAmount: 0,
    receivedAmount: 5_000_000,
    status: 'pending',
    attempts: 1,
    failureReason: null,
    paidOutAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

type Mocks<K extends string> = Record<K, jest.Mock>

function setup(): {
  service: PayoutsService
  payouts: Mocks<
    'findOne' | 'find' | 'findAndCount' | 'create' | 'save' | 'updateOne'
  >
  wallets: Mocks<'findOne'>
  notifications: Mocks<'createNotificationOnce'>
} {
  const payouts = {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn((value: Partial<Payout>) => ({
      _id: new ObjectId(),
      ...value,
    })),
    save: jest.fn((value: Payout) => Promise.resolve(value)),
    updateOne: jest.fn(),
  }
  const wallets = { findOne: jest.fn() }
  const notifications = {
    createNotificationOnce: jest.fn().mockResolvedValue({}),
  }
  const service = new PayoutsService(
    payouts as never,
    wallets as never,
    notifications as never
  )
  return { service, payouts, wallets, notifications }
}

const source = {
  paymentId: 'pay-1',
  contractId: 'c-1',
  landlordId: LANDLORD,
  amount: 5_000_000,
}

describe('PayoutsService.createForPayment', () => {
  it('creates a pending payout with fee 0 and notifies the landlord', async () => {
    const { service, payouts, wallets, notifications } = setup()
    payouts.findOne.mockResolvedValue(null)
    wallets.findOne.mockResolvedValue({ _id: walletId, status: 'linked' })

    const payout = await service.createForPayment(source)

    expect(payout.status).toBe('pending')
    expect(payout.sentAmount).toBe(5_000_000)
    expect(payout.feeAmount).toBe(0)
    expect(payout.receivedAmount).toBe(5_000_000)
    expect(payout.txRef).toMatch(/^PAYOUT-[0-9a-f]{24}$/)
    expect(payout.walletId).toBe(walletId.toHexString())
    expect(notifications.createNotificationOnce).toHaveBeenCalledWith(
      LANDLORD,
      expect.stringContaining(':pending:1'),
      expect.any(String),
      expect.any(String),
      'PAYOUT_PENDING',
      expect.objectContaining({
        link: `/landlord/payouts/${payout.txRef}`,
        amount: 5_000_000,
      })
    )
  })

  it('returns the existing payout without creating another (replayed callback)', async () => {
    const { service, payouts } = setup()
    const existing = makePayout()
    payouts.findOne.mockResolvedValue(existing)

    await expect(service.createForPayment(source)).resolves.toBe(existing)
    expect(payouts.save).not.toHaveBeenCalled()
  })

  it('keeps awaiting-wallet and starts no transfer when the landlord has no linked wallet', async () => {
    const { service, payouts, wallets, notifications } = setup()
    payouts.findOne.mockResolvedValue(null)
    wallets.findOne.mockResolvedValue(null)

    const payout = await service.createForPayment(source)

    expect(payout.status).toBe('awaiting-wallet')
    expect(payout.txRef).toBeNull()
    expect(notifications.createNotificationOnce).not.toHaveBeenCalled()
  })

  it('handles a duplicate-key race by returning the winner', async () => {
    const { service, payouts, wallets } = setup()
    const winner = makePayout()
    payouts.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner)
    wallets.findOne.mockResolvedValue({ _id: walletId })
    payouts.save.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 11000 })
    )

    await expect(service.createForPayment(source)).resolves.toBe(winner)
  })

  it('rethrows non-duplicate save errors', async () => {
    const { service, payouts } = setup()
    payouts.findOne.mockResolvedValue(null)
    payouts.save.mockRejectedValueOnce(new Error('db down'))

    await expect(service.createForPayment(source)).rejects.toThrow('db down')
  })

  it('rethrows a duplicate-key error when the winner cannot be found', async () => {
    const { service, payouts } = setup()
    payouts.findOne.mockResolvedValue(null)
    payouts.save.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 11000 })
    )

    await expect(service.createForPayment(source)).rejects.toThrow('dup')
  })

  it('does not fail the payout when the notification service throws', async () => {
    const { service, payouts, wallets, notifications } = setup()
    payouts.findOne.mockResolvedValue(null)
    wallets.findOne.mockResolvedValue({ _id: walletId })
    notifications.createNotificationOnce.mockRejectedValue(new Error('smtp'))

    await expect(service.createForPayment(source)).resolves.toMatchObject({
      status: 'pending',
    })
  })
})

describe('PayoutsService.releaseAwaitingWallet', () => {
  it('moves awaiting payouts to pending once a wallet is linked', async () => {
    const { service, payouts, wallets } = setup()
    payouts.find.mockResolvedValue([
      makePayout({ status: 'awaiting-wallet', txRef: null, walletId: null }),
    ])
    wallets.findOne.mockResolvedValue({ _id: walletId })

    await expect(service.releaseAwaitingWallet(LANDLORD)).resolves.toBe(1)
    expect(payouts.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    )
  })

  it('returns 0 when nothing is waiting', async () => {
    const { service, payouts } = setup()
    payouts.find.mockResolvedValue([])

    await expect(service.releaseAwaitingWallet(LANDLORD)).resolves.toBe(0)
    expect(payouts.save).not.toHaveBeenCalled()
  })
})

describe('PayoutsService.settleForLandlord', () => {
  function withPending(): ReturnType<typeof setup> & { pending: Payout } {
    const ctx = setup()
    const pending = makePayout()
    ctx.payouts.findOne.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          where.txRef === 'PAYOUT-1' || where._id ? pending : null
        )
    )
    ctx.wallets.findOne.mockResolvedValue({ _id: walletId, simulation: true })
    return { ...ctx, pending }
  }

  it('marks paid-out and sends one received notification on success', async () => {
    const { service, payouts, notifications, pending } = withPending()
    payouts.updateOne.mockImplementation(() => {
      pending.status = 'paid-out'
      pending.paidOutAt = new Date()
      return Promise.resolve({ modifiedCount: 1 })
    })

    const result = await service.settleForLandlord(
      'PAYOUT-1',
      'success',
      LANDLORD
    )

    expect(result.replayed).toBe(false)
    expect(result.payout.status).toBe('paid-out')
    expect(payouts.updateOne).toHaveBeenCalledWith(
      { _id: pending._id, status: 'pending' },
      expect.any(Object)
    )
    expect(notifications.createNotificationOnce).toHaveBeenCalledWith(
      LANDLORD,
      `payout:${pending._id.toHexString()}:received`,
      expect.any(String),
      expect.stringContaining('tài khoản ngân hàng'),
      'PAYOUT_RECEIVED',
      expect.objectContaining({
        sentAmount: 5_000_000,
        receivedAmount: 5_000_000,
      })
    )
    const [, , , message] = notifications.createNotificationOnce.mock
      .calls[0] as [string, string, string, string, string, unknown]
    expect(message).not.toMatch(/ví/i)
    expect(message).not.toMatch(/số dư/i)
  })

  it('does not write to any wallet balance field when settling successfully', async () => {
    const { service, payouts, wallets } = withPending()
    payouts.updateOne.mockResolvedValue({ modifiedCount: 1 })

    await service.settleForLandlord('PAYOUT-1', 'success', LANDLORD)

    // settle() no longer credits a wallet balance: the only repository call
    // on `wallets` is the simulation-only lookup already asserted elsewhere.
    expect(wallets.findOne).toHaveBeenCalledTimes(1)
  })

  it('does not notify or touch the payout again when the transfer failed or the race was lost', async () => {
    const { service, payouts, notifications } = withPending()
    payouts.updateOne.mockResolvedValue({ modifiedCount: 1 })
    await service.settleForLandlord('PAYOUT-1', 'failed', LANDLORD)
    expect(notifications.createNotificationOnce).not.toHaveBeenCalled()

    payouts.updateOne.mockResolvedValue({ modifiedCount: 0 })
    await service.settleForLandlord('PAYOUT-1', 'success', LANDLORD)

    expect(notifications.createNotificationOnce).not.toHaveBeenCalled()
  })

  it('marks failed with a reason and does not send a received notification', async () => {
    const { service, payouts, notifications, pending } = withPending()
    payouts.updateOne.mockImplementation(() => {
      pending.status = 'failed'
      pending.failureReason = 'TRANSFER_FAILED'
      return Promise.resolve({ modifiedCount: 1 })
    })

    const result = await service.settleForLandlord(
      'PAYOUT-1',
      'failed',
      LANDLORD
    )

    expect(result.payout.status).toBe('failed')
    expect(result.payout.failureReason).toBe('TRANSFER_FAILED')
    expect(notifications.createNotificationOnce).not.toHaveBeenCalled()
  })

  it('is idempotent when the payout is already final', async () => {
    const { service, payouts, notifications, pending } = withPending()
    pending.status = 'paid-out'

    const result = await service.settleForLandlord(
      'PAYOUT-1',
      'success',
      LANDLORD
    )

    expect(result.replayed).toBe(true)
    expect(payouts.updateOne).not.toHaveBeenCalled()
    expect(notifications.createNotificationOnce).not.toHaveBeenCalled()
  })

  it('reports replayed and sends nothing when it loses the conditional update race', async () => {
    const { service, payouts, notifications } = withPending()
    payouts.updateOne.mockResolvedValue({ modifiedCount: 0 })

    const result = await service.settleForLandlord(
      'PAYOUT-1',
      'success',
      LANDLORD
    )

    expect(result.replayed).toBe(true)
    expect(notifications.createNotificationOnce).not.toHaveBeenCalled()
  })

  it('settles a repeated callback only once through the pending condition', async () => {
    const { service, payouts, notifications, pending } = withPending()
    payouts.updateOne.mockImplementation(() => {
      pending.status = 'paid-out'
      pending.paidOutAt = new Date()
      return Promise.resolve({ modifiedCount: 1 })
    })

    const first = await service.settleForLandlord(
      'PAYOUT-1',
      'success',
      LANDLORD
    )
    const second = await service.settleForLandlord(
      'PAYOUT-1',
      'success',
      LANDLORD
    )

    expect(first.replayed).toBe(false)
    expect(second.replayed).toBe(true)
    expect(payouts.updateOne).toHaveBeenCalledTimes(1)
    expect(notifications.createNotificationOnce).toHaveBeenCalledTimes(1)
  })

  it('throws 404 for an unknown txRef', async () => {
    const { service } = withPending()

    await expect(
      service.settleForLandlord('PAYOUT-NOPE', 'success', LANDLORD)
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it("throws 404 for another landlord's txRef", async () => {
    const { service } = withPending()

    await expect(
      service.settleForLandlord('PAYOUT-1', 'success', 'someone-else')
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rejects when the destination wallet is not a simulation wallet', async () => {
    const { service, wallets } = withPending()
    wallets.findOne.mockResolvedValue({ _id: walletId, simulation: false })

    await expect(
      service.settleForLandlord('PAYOUT-1', 'success', LANDLORD)
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('rejects when the payout has no wallet', async () => {
    const { service, pending } = withPending()
    pending.walletId = null

    await expect(
      service.settleForLandlord('PAYOUT-1', 'success', LANDLORD)
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('PayoutsService.retry', () => {
  it('returns a failed payout to pending with a new txRef and attempts + 1', async () => {
    const { service, payouts, wallets } = setup()
    const failed = makePayout({
      status: 'failed',
      failureReason: 'TRANSFER_FAILED',
    })
    payouts.findOne.mockResolvedValue(failed)
    wallets.findOne.mockResolvedValue({ _id: walletId })

    const result = await service.retry(failed._id.toHexString())

    expect(result.status).toBe('pending')
    expect(result.attempts).toBe(2)
    expect(result.txRef).not.toBe('PAYOUT-1')
    expect(result.failureReason).toBeNull()
  })

  it('refuses to retry a payout that is not failed', async () => {
    const { service, payouts } = setup()
    payouts.findOne.mockResolvedValue(makePayout({ status: 'paid-out' }))

    await expect(
      service.retry(new ObjectId().toHexString())
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('throws 404 for an invalid or unknown id', async () => {
    const { service, payouts } = setup()
    payouts.findOne.mockResolvedValue(null)

    await expect(service.retry('not-an-id')).rejects.toBeInstanceOf(
      NotFoundException
    )
    await expect(
      service.retry(new ObjectId().toHexString())
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('PayoutsService queries', () => {
  it('lists only the landlord payouts with clamped paging', async () => {
    const { service, payouts } = setup()
    const items = [makePayout()]
    payouts.findAndCount.mockResolvedValue([items, 1])

    const result = await service.listForLandlord(LANDLORD, Number.NaN, 1000)

    expect(result).toEqual({ items, total: 1, page: 1, limit: 100 })
    expect(payouts.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { landlordId: LANDLORD },
        skip: 0,
        take: 100,
      })
    )
  })

  it('returns an empty page when there are no payouts', async () => {
    const { service, payouts } = setup()
    payouts.findAndCount.mockResolvedValue([[], 0])

    await expect(service.listForLandlord(LANDLORD, 2, 10)).resolves.toEqual({
      items: [],
      total: 0,
      page: 2,
      limit: 10,
    })
  })

  it('hides payouts that belong to someone else behind a 404', async () => {
    const { service, payouts } = setup()
    const other = makePayout({ landlordId: 'other' })
    payouts.findOne.mockResolvedValue(other)

    await expect(
      service.getForLandlord(other._id.toHexString(), LANDLORD)
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.getByTxRefForLandlord('PAYOUT-1', LANDLORD)
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('returns my payout by id and by txRef', async () => {
    const { service, payouts } = setup()
    const mine = makePayout()
    payouts.findOne.mockResolvedValue(mine)

    await expect(
      service.getForLandlord(mine._id.toHexString(), LANDLORD)
    ).resolves.toBe(mine)
    await expect(
      service.getByTxRefForLandlord('PAYOUT-1', LANDLORD)
    ).resolves.toBe(mine)
  })

  it('throws 404 when the txRef does not exist', async () => {
    const { service, payouts } = setup()
    payouts.findOne.mockResolvedValue(null)

    await expect(
      service.getByTxRefForLandlord('PAYOUT-X', LANDLORD)
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
