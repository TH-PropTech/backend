import { ObjectId } from 'mongodb'
import { PayoutsService } from '../src/modules/payouts/payouts.service'
import type { Payout } from '../src/modules/payouts/schemas/payout.schema'

/** [uc_landlord_payout] Luồng giả lập: khách trả xong -> pending -> success/failed -> retry. */

const LANDLORD = 'landlord-e2e'
const WALLET_ID = new ObjectId()

type Doc = Record<string, unknown>

function matches(doc: Doc, where: Doc): boolean {
  return Object.entries(where).every(([key, value]) =>
    value instanceof ObjectId
      ? (doc[key] as ObjectId | undefined)?.equals(value)
      : doc[key] === value
  )
}

function setup(options: { walletLinked: boolean }): {
  service: PayoutsService
  store: Payout[]
  notifications: { type: string; key: string; data: Doc }[]
  linkWallet: () => void
} {
  const store: Payout[] = []
  const notifications: { type: string; key: string; data: Doc }[] = []
  let walletLinked = options.walletLinked

  const payoutRepository = {
    findOne: ({ where }: { where: Doc }): Promise<Payout | null> =>
      Promise.resolve(
        store.find(p => matches(p as unknown as Doc, where)) ?? null
      ),
    find: ({ where }: { where: Doc }): Promise<Payout[]> =>
      Promise.resolve(store.filter(p => matches(p as unknown as Doc, where))),
    create: (value: Partial<Payout>): Payout =>
      ({
        _id: new ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...value,
      }) as Payout,
    save: (value: Payout): Promise<Payout> => {
      if (!store.includes(value)) store.push(value)
      return Promise.resolve(value)
    },
    updateOne: (
      filter: Doc,
      update: { $set: Partial<Payout> }
    ): Promise<{ modifiedCount: number }> => {
      const target = store.find(p => matches(p as unknown as Doc, filter))
      if (!target) return Promise.resolve({ modifiedCount: 0 })
      Object.assign(target, update.$set)
      return Promise.resolve({ modifiedCount: 1 })
    },
  }
  const walletRepository = {
    findOne: ({
      where,
    }: {
      where: Doc
    }): Promise<Record<string, unknown> | null> => {
      if (where.status === 'linked' && !walletLinked)
        return Promise.resolve(null)
      return Promise.resolve({
        _id: WALLET_ID,
        userId: LANDLORD,
        status: 'linked',
        simulation: true,
      })
    },
  }
  const notificationsService = {
    createNotificationOnce: (
      _userId: string,
      key: string,
      _title: string,
      _message: string,
      type: string,
      data: Doc
    ): Promise<null> => {
      if (!notifications.some(n => n.key === key)) {
        notifications.push({ type, key, data })
      }
      return Promise.resolve(null)
    },
  }

  const service = new PayoutsService(
    payoutRepository as never,
    walletRepository as never,
    notificationsService as never,
    { creditPayout: () => Promise.resolve({}) } as never
  )
  return {
    service,
    store,
    notifications,
    linkWallet: (): void => {
      walletLinked = true
    },
  }
}

const source = {
  paymentId: 'payment-e2e',
  contractId: 'contract-e2e',
  landlordId: LANDLORD,
  amount: 5_000_000,
}

describe('Landlord payout simulated flow (e2e)', () => {
  it('customer pays -> pending -> success -> paid-out with a single notification', async () => {
    const { service, store, notifications } = setup({ walletLinked: true })

    const payout = await service.createForPayment(source)
    expect(payout.status).toBe('pending')
    expect(payout.sentAmount).toBe(5_000_000)
    expect(payout.feeAmount).toBe(0)
    expect(payout.receivedAmount).toBe(5_000_000)
    expect(payout.txRef).toMatch(/^PAYOUT-/)
    expect(notifications.map(n => n.type)).toEqual(['PAYOUT_PENDING'])

    // Callback thanh toán lặp không tạo payout thứ hai.
    await service.createForPayment(source)
    expect(store).toHaveLength(1)

    const settled = await service.settleForLandlord(
      payout.txRef as string,
      'success',
      LANDLORD
    )
    expect(settled.replayed).toBe(false)
    expect(settled.payout.status).toBe('paid-out')
    expect(settled.payout.paidOutAt).toBeInstanceOf(Date)
    expect(notifications.map(n => n.type)).toEqual([
      'PAYOUT_PENDING',
      'PAYOUT_RECEIVED',
    ])

    // Gọi lại URL success: không đổi trạng thái, không thêm thông báo.
    const replay = await service.settleForLandlord(
      payout.txRef as string,
      'success',
      LANDLORD
    )
    expect(replay.replayed).toBe(true)
    expect(replay.payout.status).toBe('paid-out')
    expect(notifications).toHaveLength(2)
  })

  it('failed transfer -> failed -> retry -> pending with new txRef -> paid-out', async () => {
    const { service, notifications } = setup({ walletLinked: true })
    const payout = await service.createForPayment(source)
    const firstTxRef = payout.txRef as string

    const failed = await service.settleForLandlord(
      firstTxRef,
      'failed',
      LANDLORD
    )
    expect(failed.payout.status).toBe('failed')
    expect(failed.payout.failureReason).toBe('TRANSFER_FAILED')
    expect(notifications.map(n => n.type)).toEqual(['PAYOUT_PENDING'])

    const retried = await service.retry(payout._id.toHexString())
    expect(retried.status).toBe('pending')
    expect(retried.attempts).toBe(2)
    expect(retried.txRef).not.toBe(firstTxRef)
    expect(notifications.map(n => n.type)).toEqual([
      'PAYOUT_PENDING',
      'PAYOUT_PENDING',
    ])

    const done = await service.settleForLandlord(
      retried.txRef as string,
      'success',
      LANDLORD
    )
    expect(done.payout.status).toBe('paid-out')
    expect(notifications.at(-1)?.type).toBe('PAYOUT_RECEIVED')
  })

  it('awaits wallet link, then releases to pending', async () => {
    const { service, linkWallet } = setup({ walletLinked: false })
    const payout = await service.createForPayment(source)
    expect(payout.status).toBe('awaiting-wallet')
    expect(payout.txRef).toBeNull()

    linkWallet()
    expect(await service.releaseAwaitingWallet(LANDLORD)).toBe(1)
    const released = await service.getForLandlord(
      payout._id.toHexString(),
      LANDLORD
    )
    expect(released.status).toBe('pending')
  })

  it('rejects settling an unknown txRef or another landlord', async () => {
    const { service } = setup({ walletLinked: true })
    const payout = await service.createForPayment(source)

    await expect(
      service.settleForLandlord('PAYOUT-unknown', 'success', LANDLORD)
    ).rejects.toThrow('PAYOUT_NOT_FOUND')
    await expect(
      service.settleForLandlord(
        payout.txRef as string,
        'success',
        'someone-else'
      )
    ).rejects.toThrow('PAYOUT_NOT_FOUND')
  })
})
