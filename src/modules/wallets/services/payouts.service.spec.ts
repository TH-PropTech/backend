import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { PayoutsService } from './payouts.service'
import type { Payout } from '../schemas/payout.schema'
import { MocbankPayoutError } from './mocbank-payout.client'

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
    directReceipt: false,
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

describe('PayoutsService direct receipt (Ví Mộc trả thẳng chủ nhà)', () => {
  const paidAt = new Date('2026-10-17T10:00:00.000Z')

  it('records a paid-out payout at once with no transfer and one notification', async () => {
    const { service, payouts, wallets, notifications } = setup()
    payouts.findOne.mockResolvedValue(null)
    wallets.findOne.mockResolvedValue({ _id: walletId, status: 'linked' })

    const payout = await service.createForPayment({
      ...source,
      directReceipt: { paidAt },
    })

    expect(payout).toMatchObject({
      status: 'paid-out',
      paidOutAt: paidAt,
      directReceipt: true,
      txRef: null,
      sentAmount: 5_000_000,
      receivedAmount: 5_000_000,
      walletId: walletId.toHexString(),
    })
    expect(notifications.createNotificationOnce).toHaveBeenCalledTimes(1)
    expect(notifications.createNotificationOnce).toHaveBeenCalledWith(
      LANDLORD,
      expect.stringContaining(':received'),
      'Bạn đã nhận tiền',
      expect.stringMatching(/thanh toán trực tiếp[\s\S]*Techcombank/),
      'PAYOUT_RECEIVED',
      expect.any(Object)
    )
  })

  it('still records the receipt when the landlord has no linked wallet record', async () => {
    const { service, payouts, wallets } = setup()
    payouts.findOne.mockResolvedValue(null)
    wallets.findOne.mockResolvedValue(null)

    const payout = await service.createForPayment({
      ...source,
      directReceipt: { paidAt },
    })

    expect(payout.status).toBe('paid-out')
    expect(payout.walletId).toBeNull()
  })

  it('is idempotent for a replayed callback', async () => {
    const { service, payouts, notifications } = setup()
    const existing = makePayout({ status: 'paid-out', directReceipt: true })
    payouts.findOne.mockResolvedValue(existing)

    await expect(
      service.createForPayment({ ...source, directReceipt: { paidAt } })
    ).resolves.toBe(existing)
    expect(payouts.save).not.toHaveBeenCalled()
    expect(notifications.createNotificationOnce).not.toHaveBeenCalled()
  })

  it('refuses the landlord simulation endpoint for a direct receipt', async () => {
    const { service, payouts } = setup()
    payouts.findOne.mockResolvedValue(
      makePayout({ status: 'paid-out', directReceipt: true, txRef: 'PAYOUT-D' })
    )

    await expect(
      service.settleForLandlord('PAYOUT-D', 'failed', LANDLORD)
    ).rejects.toThrow('PAYOUT_ALREADY_RECEIVED')
    expect(payouts.updateOne).not.toHaveBeenCalled()
  })
})

describe('PayoutsService simulated relay to the landlord Ví Mộc wallet', () => {
  const ACCOUNT = '810000000002'
  const mocWallet = {
    _id: walletId,
    status: 'linked',
    provider: 'mocbank',
    simulation: false,
    mocbankAccountNumber: ACCOUNT,
  }

  function relaySetup(options: {
    wallet?: Record<string, unknown> | null
    configured?: boolean
    payout?: jest.Mock
  }): ReturnType<typeof setup> & {
    stored: { current: Payout | null }
    client: { isConfigured: jest.Mock; payout: jest.Mock }
  } {
    const base = setup()
    const stored: { current: Payout | null } = { current: null }
    base.payouts.findOne.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(where._id ? stored.current : null)
    )
    base.payouts.save.mockImplementation((value: Payout) => {
      stored.current = value
      return Promise.resolve(value)
    })
    base.payouts.updateOne.mockImplementation(
      (_filter: unknown, update: { $set: Partial<Payout> }) => {
        Object.assign(stored.current as Payout, update.$set)
        return Promise.resolve({ modifiedCount: 1 })
      }
    )
    base.wallets.findOne.mockResolvedValue(
      options.wallet === undefined ? mocWallet : options.wallet
    )
    const client = {
      isConfigured: jest.fn().mockReturnValue(options.configured ?? true),
      payout:
        options.payout ??
        jest.fn().mockResolvedValue({ transactionCode: 'TX_RELAY_1' }),
    }
    const service = new PayoutsService(
      base.payouts as never,
      base.wallets as never,
      base.notifications as never,
      client as never
    )
    return { ...base, service, stored, client }
  }

  it('transfers on its own, marks paid-out and tells the landlord it is a simulation', async () => {
    const { service, client, notifications } = relaySetup({})

    const payout = await service.createForPayment(source)

    expect(client.payout).toHaveBeenCalledWith({
      orderId: `PAYOUT-${payout._id.toHexString()}`,
      amount: 5_000_000,
      payeeAccountNumber: ACCOUNT,
      description: expect.stringContaining('Chuyển hộ') as string,
    })
    expect(payout).toMatchObject({
      status: 'paid-out',
      relayRef: 'TX_RELAY_1',
      directReceipt: false,
    })
    expect(notifications.createNotificationOnce).toHaveBeenCalledTimes(1)
    expect(notifications.createNotificationOnce).toHaveBeenCalledWith(
      LANDLORD,
      expect.stringContaining(':received'),
      'Bạn đã nhận tiền',
      expect.stringMatching(/giả lập[\s\S]*Techcombank/),
      'PAYOUT_RECEIVED',
      expect.objectContaining({
        simulatedRelay: true,
        transactionCode: 'TX_RELAY_1',
      })
    )
  })

  it('marks the payout failed with the bank reason and sends no success notification', async () => {
    const { service, notifications } = relaySetup({
      payout: jest
        .fn()
        .mockRejectedValue(new MocbankPayoutError('INSUFFICIENT_BALANCE')),
    })

    const payout = await service.createForPayment(source)

    expect(payout).toMatchObject({
      status: 'failed',
      failureReason: 'INSUFFICIENT_BALANCE',
    })
    expect(notifications.createNotificationOnce).not.toHaveBeenCalled()
  })

  it('maps an unexpected error to TRANSFER_FAILED', async () => {
    const { service } = relaySetup({
      payout: jest.fn().mockRejectedValue(new Error('boom')),
    })

    await expect(service.createForPayment(source)).resolves.toMatchObject({
      status: 'failed',
      failureReason: 'TRANSFER_FAILED',
    })
  })

  it('retries with the same bank order id so a lost reply never pays twice', async () => {
    const payoutMock = jest
      .fn()
      .mockRejectedValueOnce(new MocbankPayoutError('GATEWAY_UNAVAILABLE'))
      .mockResolvedValueOnce({ transactionCode: 'TX_RELAY_2' })
    const { service, client } = relaySetup({ payout: payoutMock })

    const failed = await service.createForPayment(source)
    expect(failed.status).toBe('failed')
    const retried = await service.retry(failed._id.toHexString())

    expect(retried).toMatchObject({ status: 'paid-out', attempts: 2 })
    const calls = client.payout.mock.calls as Array<[{ orderId: string }]>
    const orderIds = calls.map(call => call[0].orderId)
    expect(orderIds).toHaveLength(2)
    expect(orderIds[0]).toBe(orderIds[1])
  })

  it('falls back to the manual simulation when Ví Mộc payout is not configured', async () => {
    const { service, client, notifications } = relaySetup({ configured: false })

    const payout = await service.createForPayment(source)

    expect(client.payout).not.toHaveBeenCalled()
    expect(payout.status).toBe('pending')
    expect(notifications.createNotificationOnce).toHaveBeenCalledWith(
      LANDLORD,
      expect.stringContaining(':pending:'),
      expect.any(String),
      expect.any(String),
      'PAYOUT_PENDING',
      expect.any(Object)
    )
  })

  it('keeps the manual simulation for a simulated (non Ví Mộc) wallet', async () => {
    const { service, client } = relaySetup({
      wallet: { _id: walletId, status: 'linked', provider: 'mock-bank' },
    })

    const payout = await service.createForPayment(source)

    expect(client.payout).not.toHaveBeenCalled()
    expect(payout.status).toBe('pending')
  })

  it('does not call the bank while the landlord has no linked wallet', async () => {
    const { service, client } = relaySetup({ wallet: null })

    const payout = await service.createForPayment(source)

    expect(client.payout).not.toHaveBeenCalled()
    expect(payout.status).toBe('awaiting-wallet')
  })

  it('relays waiting payouts once the landlord links a Ví Mộc wallet', async () => {
    const { service, payouts, client } = relaySetup({})
    const waiting = makePayout({
      status: 'awaiting-wallet',
      walletId: null,
      txRef: null,
    })
    payouts.find.mockResolvedValue([waiting])

    await expect(service.releaseAwaitingWallet(LANDLORD)).resolves.toBe(1)

    expect(client.payout).toHaveBeenCalledTimes(1)
  })
})

describe('PayoutsService.getContractSummary', () => {
  function setupSummary(): {
    service: PayoutsService
    contracts: Mocks<'findOne'>
    payments: Mocks<'find'>
    deposits: Mocks<'findOne'>
    payouts: Mocks<'find'>
    wallets: Mocks<'findOne'>
  } {
    const payouts = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    }
    const wallets = { findOne: jest.fn().mockResolvedValue(null) }
    const notifications = { createNotificationOnce: jest.fn() }
    const contracts = { findOne: jest.fn() }
    const payments = { find: jest.fn().mockResolvedValue([]) }
    const deposits = { findOne: jest.fn().mockResolvedValue(null) }
    const service = new PayoutsService(
      payouts as never,
      wallets as never,
      notifications as never,
      undefined,
      contracts as never,
      payments as never,
      deposits as never
    )
    return { service, contracts, payments, deposits, payouts, wallets }
  }

  const contractId = new ObjectId().toHexString()

  it('returns 404 when the contract does not exist', async () => {
    const { service, contracts } = setupSummary()
    contracts.findOne.mockResolvedValue(null)
    await expect(
      service.getContractSummary(contractId, {
        userId: LANDLORD,
        isLandlordScoped: true,
      })
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('returns 404 when a different landlord asks for a contract that is not theirs', async () => {
    const { service, contracts } = setupSummary()
    contracts.findOne.mockResolvedValue({ landlordId: 'someone-else' })
    await expect(
      service.getContractSummary(contractId, {
        userId: LANDLORD,
        isLandlordScoped: true,
      })
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('reports the deposit line, the first-rent payout, and an unpaid future rent, with wallet status', async () => {
    const { service, contracts, payments, deposits, payouts, wallets } =
      setupSummary()
    contracts.findOne.mockResolvedValue({ landlordId: LANDLORD })
    wallets.findOne.mockResolvedValue({ userId: LANDLORD, status: 'linked' })
    deposits.findOne.mockResolvedValue({
      _id: new ObjectId(),
      amount: 10_000_000,
      status: 'applied-to-lease-security',
      escrow: { status: 'HELD' },
    })
    const firstRentId = new ObjectId()
    const secondRentId = new ObjectId()
    payments.find.mockResolvedValue([
      {
        _id: secondRentId,
        periodKey: '2030-02',
        amount: 5_000_000,
        dueDate: new Date('2030-02-01'),
      },
      {
        _id: firstRentId,
        periodKey: '2030-01',
        amount: 5_000_000,
        dueDate: new Date('2030-01-01'),
      },
    ])
    payouts.find.mockResolvedValue([
      makePayout({
        paymentId: firstRentId.toHexString(),
        status: 'paid-out',
        sentAmount: 5_000_000,
        receivedAmount: 5_000_000,
      }),
    ])

    const result = await service.getContractSummary(contractId, {
      userId: LANDLORD,
      isLandlordScoped: true,
    })

    expect(result.wallet).toEqual({ linked: true })
    expect(result.items).toEqual([
      expect.objectContaining({ kind: 'DEPOSIT', status: 'held' }),
      expect.objectContaining({
        kind: 'RENT',
        ref: firstRentId.toHexString(),
        status: 'paid-out',
      }),
      expect.objectContaining({
        kind: 'RENT',
        ref: secondRentId.toHexString(),
        status: 'unpaid',
      }),
    ])
    expect(result.totals).toEqual({ received: 5_000_000, pending: 10_000_000 })
  })

  it('reports the wallet as not linked so the UI can prompt linking it', async () => {
    const { service, contracts, wallets } = setupSummary()
    contracts.findOne.mockResolvedValue({ landlordId: LANDLORD })
    wallets.findOne.mockResolvedValue(null)

    const result = await service.getContractSummary(contractId, {
      userId: LANDLORD,
      isLandlordScoped: true,
    })

    expect(result.wallet).toEqual({ linked: false })
  })

  it('lets staff view any contract regardless of landlordId', async () => {
    const { service, contracts } = setupSummary()
    contracts.findOne.mockResolvedValue({ landlordId: 'someone-else' })

    await expect(
      service.getContractSummary(contractId, {
        userId: 'staff-1',
        isLandlordScoped: false,
      })
    ).resolves.toMatchObject({ contractId })
  })
})
