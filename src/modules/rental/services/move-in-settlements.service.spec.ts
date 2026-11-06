import { ForbiddenException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { getMetadataArgsStorage } from 'typeorm'
import { MoveInSettlementsService } from './move-in-settlements.service'
import { MoveInSettlement } from '../schemas/move-in-settlement.schema'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { Payment } from '../../payments/schemas/payment.schema'
import { RentalTransactionEventService } from '../services/rental-transaction-event.service'
import type { RentalTransactionEvent } from '../schemas/rental-transaction-event.schema'

function createInMemoryTransactionEventService(): {
  service: RentalTransactionEventService
  events: RentalTransactionEvent[]
} {
  const events: RentalTransactionEvent[] = []
  const repository = {
    findOne: jest.fn(({ where }: { where: { transitionKey: string } }) =>
      Promise.resolve(
        events.find(event => event.transitionKey === where.transitionKey) ??
          null
      )
    ),
    create: jest.fn(
      (input: Partial<RentalTransactionEvent>) =>
        ({ ...input }) as RentalTransactionEvent
    ),
    save: jest.fn((event: RentalTransactionEvent) => {
      events.push(event)
      return Promise.resolve(event)
    }),
  }
  return {
    service: new RentalTransactionEventService(repository as never),
    events,
  }
}

describe('MoveInSettlementsService', () => {
  function setup(): {
    service: MoveInSettlementsService
    settlementRepo: Record<'findOne' | 'find' | 'create' | 'save', jest.Mock>
    paymentRepo: {
      find: jest.Mock
      findOne: jest.Mock
      create: jest.Mock
      save: jest.Mock
    }
    notifications: { createNotification: jest.Mock }
  } {
    const settlementRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn((value: Record<string, unknown>) =>
        Promise.resolve({
          ...value,
          _id: value._id instanceof ObjectId ? value._id : new ObjectId(),
        })
      ),
    }
    const paymentRepo = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Record<string, unknown>) => ({
        ...value,
        _id: new ObjectId(),
      })),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    }
    const contractRepo = {
      save: jest.fn(
        (value: unknown): Promise<unknown> => Promise.resolve(value)
      ),
    }
    return {
      service: new MoveInSettlementsService(
        settlementRepo as never,
        contractRepo as never,
        paymentRepo as never,
        notifications as never
      ),
      settlementRepo,
      paymentRepo,
      notifications,
    }
  }

  it('creates a single statement with holding top-up and first-cycle rent', async () => {
    const { service, settlementRepo, paymentRepo } = setup()
    const firstPayment = {
      _id: new ObjectId(),
      amount: 30_000_000,
      periodKey: '2030-01',
    } as Payment
    paymentRepo.find.mockResolvedValue([firstPayment])
    const contract = {
      _id: new ObjectId(),
      tenantId: 'tenant',
      landlordId: 'landlord',
      deposit: 20_000_000,
      startDate: new Date('2030-02-01T00:00:00.000Z'),
      packageSnapshot: {
        resolvedHoldingDepositAmount: 6_000_000,
        settlementPolicy: { firstPaymentDueOffsetDays: 3 },
      },
    } as Contract

    const result = await service.createForContract(
      contract,
      new Date('2030-01-01T00:00:00.000Z')
    )

    expect(result?.lines).toEqual([
      {
        kind: 'DEPOSIT_TOPUP',
        amount: 14_000_000,
        paymentId: expect.any(String) as string,
      },
      {
        kind: 'FIRST_RENT',
        amount: 30_000_000,
        paymentId: firstPayment._id.toHexString(),
      },
    ])
    expect(result?.total).toBe(44_000_000)
    expect(result?.statementHash).toMatch(/^[a-f0-9]{64}$/)
    expect(settlementRepo.save).toHaveBeenCalledTimes(1)
    expect(paymentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'deposit-topup',
        amount: 14_000_000,
        payerId: 'tenant',
      })
    )
  })

  describe('prepaid rent', () => {
    const contractWith = (
      prepaidRentMonths: number | null | undefined
    ): Contract =>
      ({
        _id: new ObjectId(),
        tenantId: 'tenant',
        landlordId: 'landlord',
        deposit: 20_000_000,
        startDate: new Date('2030-02-01T00:00:00.000Z'),
        ...(prepaidRentMonths !== undefined ? { prepaidRentMonths } : {}),
        packageSnapshot: {
          resolvedHoldingDepositAmount: 6_000_000,
          settlementPolicy: { firstPaymentDueOffsetDays: 3 },
        },
      }) as Contract
    const firstPayment = (amount: number): Payment =>
      ({ _id: new ObjectId(), amount, periodKey: '2030-02' }) as Payment

    it('collects the prepaid months at move-in as the first-rent line', async () => {
      const { service, paymentRepo } = setup()
      paymentRepo.find.mockResolvedValue([firstPayment(60_000_000)])

      const result = await service.createForContract(
        contractWith(6),
        new Date('2030-01-01T00:00:00.000Z')
      )

      expect(result?.lines.map(line => line.kind)).toEqual([
        'DEPOSIT_TOPUP',
        'FIRST_RENT',
      ])
      expect(result?.total).toBe(14_000_000 + 60_000_000)
    })

    it('leaves the first rent out of the move-in statement when the package is deposit-only', async () => {
      const { service, paymentRepo } = setup()
      paymentRepo.find.mockResolvedValue([firstPayment(10_000_000)])

      const result = await service.createForContract(
        contractWith(0),
        new Date('2030-01-01T00:00:00.000Z')
      )

      expect(result?.lines.map(line => line.kind)).toEqual(['DEPOSIT_TOPUP'])
      expect(result?.total).toBe(14_000_000)
    })

    it('keeps the legacy behaviour for contracts that predate the prepayment policy', async () => {
      for (const legacy of [undefined, null]) {
        const { service, paymentRepo } = setup()
        paymentRepo.find.mockResolvedValue([firstPayment(10_000_000)])

        const result = await service.createForContract(
          contractWith(legacy),
          new Date('2030-01-01T00:00:00.000Z')
        )

        expect(result?.lines.map(line => line.kind)).toEqual([
          'DEPOSIT_TOPUP',
          'FIRST_RENT',
        ])
      }
    })
  })

  it('records exactly one settlement.created transaction event when creation is retried for the same contract', async () => {
    const { service, settlementRepo, paymentRepo } = setup()
    const { service: transactionEventService, events } =
      createInMemoryTransactionEventService()
    Reflect.set(service, 'transactionEventService', transactionEventService)
    const firstPayment = {
      _id: new ObjectId(),
      amount: 30_000_000,
      periodKey: '2030-01',
    } as Payment
    paymentRepo.find.mockResolvedValue([firstPayment])
    const contract = {
      _id: new ObjectId(),
      tenantId: 'tenant',
      landlordId: 'landlord',
      deposit: 20_000_000,
      startDate: new Date('2030-02-01T00:00:00.000Z'),
      packageSnapshot: {
        resolvedHoldingDepositAmount: 6_000_000,
        settlementPolicy: { firstPaymentDueOffsetDays: 3 },
      },
    } as Contract

    const created = await service.createForContract(
      contract,
      new Date('2030-01-01T00:00:00.000Z')
    )
    // Simulate a retried provisioning call for the same contract: the
    // settlement already exists, so the repository now reports it.
    settlementRepo.findOne.mockResolvedValue(created)
    await service.createForContract(
      contract,
      new Date('2030-01-01T00:00:00.000Z')
    )

    const createdEvents = events.filter(
      event => event.eventType === 'settlement.created'
    )
    expect(createdEvents).toHaveLength(1)
  })

  it('is idempotent: retrying createForContract for the same contract creates exactly one settlement and no extra invoice', async () => {
    const { service, settlementRepo, paymentRepo } = setup()
    const firstPayment = {
      _id: new ObjectId(),
      amount: 30_000_000,
      periodKey: '2030-01',
    } as Payment
    paymentRepo.find.mockResolvedValue([firstPayment])
    const contract = {
      _id: new ObjectId(),
      tenantId: 'tenant',
      landlordId: 'landlord',
      deposit: 20_000_000,
      startDate: new Date('2030-02-01T00:00:00.000Z'),
      packageSnapshot: {
        resolvedHoldingDepositAmount: 6_000_000,
        settlementPolicy: { firstPaymentDueOffsetDays: 3 },
      },
    } as Contract

    const created = await service.createForContract(
      contract,
      new Date('2030-01-01T00:00:00.000Z')
    )
    settlementRepo.findOne.mockResolvedValue(created)
    paymentRepo.save.mockClear()
    const second = await service.createForContract(
      contract,
      new Date('2030-01-01T00:00:00.000Z')
    )

    expect(second).toEqual(created)
    expect(settlementRepo.save).toHaveBeenCalledTimes(1)
    expect(paymentRepo.save).not.toHaveBeenCalled()
  })

  it('reuses an existing settlement without querying payments', async () => {
    const { service, settlementRepo, paymentRepo } = setup()
    settlementRepo.findOne.mockResolvedValue({ contractId: 'existing' })
    await expect(
      service.createForContract({
        _id: { toHexString: () => 'existing' },
      } as Contract)
    ).resolves.toEqual({ contractId: 'existing' })
    expect(paymentRepo.find).not.toHaveBeenCalled()
  })

  it('creates a FIRST_RENT-only settlement for a package without settlement policy or tenant fee', async () => {
    const { service, settlementRepo, paymentRepo } = setup()
    const firstPayment = {
      _id: new ObjectId(),
      amount: 8_000_000,
      periodKey: '2030-01',
    } as Payment
    paymentRepo.find.mockResolvedValue([firstPayment])
    const contract = {
      _id: new ObjectId(),
      tenantId: 'tenant',
      landlordId: 'landlord',
      deposit: 8_000_000,
      startDate: new Date('2030-02-01T00:00:00.000Z'),
    } as Contract

    const result = await service.createForContract(
      contract,
      new Date('2030-01-01T00:00:00.000Z')
    )

    expect(result?.lines).toEqual([
      {
        kind: 'FIRST_RENT',
        amount: 8_000_000,
        paymentId: firstPayment._id.toHexString(),
      },
    ])
    expect(result?.total).toBe(8_000_000)
    expect(result?.dueAt).toEqual(new Date('2030-01-29T00:00:00.000Z'))
    expect(settlementRepo.save).toHaveBeenCalledTimes(1)
    expect(paymentRepo.save).not.toHaveBeenCalled()
  })

  it('returns null when a contract without policy has no rent cycle and nothing to top up', async () => {
    const { service, settlementRepo, paymentRepo } = setup()
    paymentRepo.find.mockResolvedValue([])
    await expect(
      service.createForContract({
        _id: new ObjectId(),
        tenantId: 'tenant',
        landlordId: 'landlord',
        deposit: 0,
        startDate: new Date('2030-02-01T00:00:00.000Z'),
      } as Contract)
    ).resolves.toBeNull()
    expect(settlementRepo.save).not.toHaveBeenCalled()
  })

  it('requires paid settlement for handover and completes after both confirmations', async () => {
    const { service, settlementRepo } = setup()
    const row = {
      _id: new ObjectId(),
      tenantId: 'tenant',
      landlordId: 'landlord',
      status: 'pending',
      handover: null,
    }
    settlementRepo.findOne.mockResolvedValue(row)
    await expect(
      service.updateHandover(row._id.toHexString(), 'landlord', {
        handedOverAt: '2030-01-01',
        electricity: 10,
        water: 20,
        keyCount: 2,
      })
    ).rejects.toThrow('HANDOVER_REQUIRES_SETTLEMENT')
    row.status = 'paid'
    const first = await service.updateHandover(
      row._id.toHexString(),
      'landlord',
      { handedOverAt: '2030-01-01', electricity: 10, water: 20, keyCount: 2 }
    )
    const hash = first.handover?.handoverHash ?? ''
    await service.confirmHandover(
      row._id.toHexString(),
      'tenant',
      'tenant',
      hash
    )
    const completed = await service.confirmHandover(
      row._id.toHexString(),
      'landlord',
      'landlord',
      hash
    )
    expect(completed.handover?.completedAt).toBeInstanceOf(Date)
  })

  it('marks overdue and sends one notice to each party across repeated processing', async () => {
    const { service, settlementRepo, notifications } = setup()
    const row = {
      _id: new ObjectId(),
      contractId: 'contract-1',
      tenantId: 'tenant',
      landlordId: 'landlord',
      status: 'pending',
      dueAt: new Date('2030-01-01'),
      overdueNotifiedAt: null,
    }
    settlementRepo.find.mockResolvedValue([row])
    await expect(service.processOverdue(new Date('2030-01-02'))).resolves.toBe(
      1
    )
    await expect(service.processOverdue(new Date('2030-01-02'))).resolves.toBe(
      0
    )
    expect(notifications.createNotification).toHaveBeenCalledTimes(2)
    expect(row.status).toBe('overdue')
  })

  it('sends Vietnamese overdue notices without ids in text and contractId in data', async () => {
    const { service, settlementRepo, notifications } = setup()
    const contractId = new ObjectId().toHexString()
    settlementRepo.find.mockResolvedValue([
      {
        _id: new ObjectId(),
        contractId,
        tenantId: 'tenant',
        landlordId: 'landlord',
        status: 'pending',
        dueAt: new Date('2030-01-01'),
        overdueNotifiedAt: null,
      },
    ])

    await service.processOverdue(new Date('2030-01-02'))

    expect(notifications.createNotification).toHaveBeenCalledTimes(2)
    for (const call of notifications.createNotification.mock.calls) {
      const [, title, body, type, data] = call as unknown[]
      const text = `${String(title)} ${String(body)}`
      expect(title).toBe('Quyết toán dọn nhà đã quá hạn')
      expect(text).not.toMatch(/Settlement/)
      expect(text).not.toMatch(/[0-9a-f]{24}/i)
      expect(type).toBe('PAYMENT_REMINDER')
      expect(data).toEqual({ contractId })
    }
  })

  it('does not notify rows that are not yet due', async () => {
    const { service, settlementRepo, notifications } = setup()
    settlementRepo.find.mockResolvedValue([
      {
        _id: new ObjectId(),
        contractId: 'c',
        tenantId: 't',
        landlordId: 'l',
        status: 'pending',
        dueAt: new Date('2030-01-03'),
        overdueNotifiedAt: null,
      },
    ])

    await expect(service.processOverdue(new Date('2030-01-02'))).resolves.toBe(
      0
    )
    expect(notifications.createNotification).not.toHaveBeenCalled()
  })
})

describe('MoveInSettlementsService handover (phương án A)', () => {
  const RECORD = {
    handedOverAt: '2030-02-01T09:00:00.000Z',
    electricity: 120,
    water: 45,
    keyCount: 2,
  }
  const T0 = new Date('2030-02-01T10:00:00.000Z')
  const AFTER_DEADLINE = new Date('2030-02-04T10:00:00.001Z')

  type Row = {
    _id: ObjectId
    contractId: string
    tenantId: string
    landlordId: string
    status: string
    handover: MoveInSettlement['handover']
  }

  function setup(status = 'paid'): {
    service: MoveInSettlementsService
    row: Row
    id: string
    notifications: { createNotification: jest.Mock }
    outbox: { enqueue: jest.Mock }
    settlementRepo: {
      findOne: jest.Mock
      find: jest.Mock
      save: jest.Mock
    }
  } {
    const row: Row = {
      _id: new ObjectId(),
      contractId: 'contract-1',
      tenantId: 'tenant',
      landlordId: 'landlord',
      status,
      handover: null,
    }
    const settlementRepo = {
      findOne: jest.fn().mockResolvedValue(row),
      find: jest.fn().mockResolvedValue([row]),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    }
    const outbox = { enqueue: jest.fn().mockResolvedValue({}) }
    const service = new MoveInSettlementsService(
      settlementRepo as never,
      {} as never,
      {} as never,
      notifications as never,
      undefined,
      outbox as never
    )
    return {
      service,
      row,
      id: row._id.toHexString(),
      notifications,
      outbox,
      settlementRepo,
    }
  }

  const notifiedUsers = (mock: jest.Mock): string[] =>
    (mock.mock.calls as Array<[string]>).map(call => call[0])

  describe('recording (5.2, 5.3)', () => {
    it('stores structured inventory items and changes the hash when any line changes', async () => {
      const items = [
        { name: 'Sofa', quantity: 1, condition: 'good' as const },
        { name: 'Tủ lạnh', quantity: 1, condition: 'good' as const },
        {
          name: 'Ghế',
          quantity: 4,
          condition: 'damaged' as const,
          note: 'Gãy chân',
        },
      ]
      const first = setup()
      const a = await first.service.updateHandover(first.id, 'landlord', {
        ...RECORD,
        inventoryItems: items,
      })
      const second = setup()
      const b = await second.service.updateHandover(second.id, 'landlord', {
        ...RECORD,
        inventoryItems: [items[0]!, items[1]!, { ...items[2]!, quantity: 3 }],
      })
      expect(a.handover?.inventoryItems).toEqual([
        { name: 'Sofa', quantity: 1, condition: 'good', note: null },
        { name: 'Tủ lạnh', quantity: 1, condition: 'good', note: null },
        { name: 'Ghế', quantity: 4, condition: 'damaged', note: 'Gãy chân' },
      ])
      expect(a.handover?.handoverHash).toMatch(/^[a-f0-9]{64}$/)
      expect(a.handover?.handoverHash).not.toBe(b.handover?.handoverHash)
    })

    it('stores meter photos in the hash only when present so legacy hashes stay valid', async () => {
      const photos = {
        electricity: ['https://cdn.example.com/dien.jpg'],
        water: ['https://cdn.example.com/nuoc.png'],
      }
      const legacy = setup()
      const a = await legacy.service.updateHandover(legacy.id, 'landlord', {
        ...RECORD,
      })
      const again = setup()
      const b = await again.service.updateHandover(again.id, 'landlord', {
        ...RECORD,
      })
      const withPhotos = setup()
      const c = await withPhotos.service.updateHandover(
        withPhotos.id,
        'landlord',
        { ...RECORD, meterPhotos: photos }
      )
      expect(a.handover?.meterPhotos).toBeUndefined()
      expect(b.handover?.handoverHash).toBe(a.handover?.handoverHash)
      expect(c.handover?.meterPhotos).toEqual(photos)
      expect(c.handover?.handoverHash).not.toBe(a.handover?.handoverHash)
    })

    it('marks the landlord as confirmed for the recorded revision and sets a 3-day response deadline', async () => {
      const { service, id } = setup()
      const saved = await service.updateHandover(id, 'landlord', RECORD, T0)
      expect(saved.handover?.landlordConfirmation).toEqual({
        at: T0,
        hash: saved.handover?.handoverHash,
      })
      expect(saved.handover?.tenantConfirmation).toBeNull()
      expect(saved.handover?.responseDueAt).toEqual(
        new Date('2030-02-04T10:00:00.000Z')
      )
      expect(saved.handover?.completionReason).toBeNull()
    })

    describe('handover template checklist', () => {
      const template = {
        version: 2,
        contentHash: 'a'.repeat(64),
        checklist: [
          { id: 'keys-handed', label: 'Đã giao chìa khóa' },
          { id: 'condition-checked', label: 'Đã kiểm tra hiện trạng' },
        ],
      }
      function withTemplate(): ReturnType<typeof setup> {
        const base = setup()
        return {
          ...base,
          service: new MoveInSettlementsService(
            base.settlementRepo as never,
            {} as never,
            {} as never,
            base.notifications as never,
            undefined,
            base.outbox as never,
            undefined,
            { getPublished: jest.fn().mockResolvedValue(template) } as never
          ),
        }
      }

      it('snapshots labels and template version, and folds them into the hash', async () => {
        const { service, id } = withTemplate()
        const plain = await setup().service.updateHandover(
          setup().id,
          'landlord',
          RECORD,
          T0
        )
        const saved = await service.updateHandover(
          id,
          'landlord',
          { ...RECORD, checklist: [{ id: 'keys-handed', checked: true }] },
          T0
        )
        expect(saved.handover?.templateRef).toEqual({
          version: 2,
          contentHash: template.contentHash,
        })
        expect(saved.handover?.checklist).toEqual([
          { id: 'keys-handed', label: 'Đã giao chìa khóa', checked: true },
          {
            id: 'condition-checked',
            label: 'Đã kiểm tra hiện trạng',
            checked: false,
          },
        ])
        expect(saved.handover?.handoverHash).not.toBe(
          plain.handover?.handoverHash
        )
      })

      it('keeps the legacy hash and no template ref when no checklist is sent', async () => {
        const { service, id } = withTemplate()
        const saved = await service.updateHandover(id, 'landlord', RECORD, T0)
        expect(saved.handover?.templateRef).toBeUndefined()
        expect(saved.handover?.checklist).toBeUndefined()
      })

      it('rejects checklist ids that are not in the published template', async () => {
        const { service, id } = withTemplate()
        await expect(
          service.updateHandover(id, 'landlord', {
            ...RECORD,
            checklist: [{ id: 'made-up', checked: true }],
          })
        ).rejects.toThrow('HANDOVER_CHECKLIST_ITEM_UNKNOWN')
      })

      it('rejects a checklist when no template is available', async () => {
        const { service, id } = setup()
        await expect(
          service.updateHandover(id, 'landlord', {
            ...RECORD,
            checklist: [{ id: 'keys-handed', checked: true }],
          })
        ).rejects.toThrow('HANDOVER_TEMPLATE_UNAVAILABLE')
      })
    })

    it('does not confirm on behalf of the landlord when staff records the handover', async () => {
      const { service, id } = setup()
      const saved = await service.updateHandover(id, 'staff-1', {
        ...RECORD,
        isStaff: true,
      })
      expect(saved.handover?.landlordConfirmation).toBeNull()
    })

    it('returns 403 when a non-landlord, non-staff user records the handover', async () => {
      const { service, id } = setup()
      await expect(
        service.updateHandover(id, 'tenant', RECORD)
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('rejects the landlord while the settlement is pending but accepts staff with an override reason', async () => {
      const { service, id, row } = setup('pending')
      await expect(
        service.updateHandover(id, 'landlord', RECORD)
      ).rejects.toThrow('HANDOVER_REQUIRES_SETTLEMENT')
      expect(row.handover).toBeNull()
      const saved = await service.updateHandover(id, 'staff-1', {
        ...RECORD,
        isStaff: true,
        overrideReason: 'Khách thuê đã trả tiền mặt tại văn phòng',
      })
      expect(saved.handover?.overrideReason).toBe(
        'Khách thuê đã trả tiền mặt tại văn phòng'
      )
    })

    it('rejects a new revision once the handover is completed', async () => {
      const { service, id } = setup()
      const saved = await service.updateHandover(id, 'landlord', RECORD)
      await service.confirmHandover(
        id,
        'tenant',
        'tenant',
        saved.handover!.handoverHash
      )
      await expect(
        service.updateHandover(id, 'landlord', RECORD)
      ).rejects.toThrow('HANDOVER_COMPLETED_IMMUTABLE')
    })

    it('lets the landlord record the handover once the deposit is confirmed, even while the settlement is still pending', async () => {
      const { row, id, settlementRepo } = setup('pending')
      row.contractId = new ObjectId().toHexString()
      const contractRepo = {
        findOne: jest.fn().mockResolvedValue({
          deposit: 10_000_000,
          depositPaidAt: null,
        }),
      }
      const depositAgreementsService = {
        findByContractId: jest.fn().mockResolvedValue({
          _id: new ObjectId(),
          status: 'applied-to-lease-security',
          amount: 10_000_000,
          paidAt: new Date('2030-01-01'),
        }),
      }
      const service = new MoveInSettlementsService(
        settlementRepo as never,
        contractRepo as never,
        {} as never,
        { createNotification: jest.fn().mockResolvedValue(undefined) } as never,
        undefined,
        { enqueue: jest.fn().mockResolvedValue({}) } as never,
        depositAgreementsService as never
      )
      const saved = await service.updateHandover(id, 'landlord', RECORD)
      expect(saved.handover?.landlordConfirmation?.hash).toBe(
        saved.handover?.handoverHash
      )
      expect(depositAgreementsService.findByContractId).toHaveBeenCalledWith(
        row.contractId
      )
    })
  })

  describe('confirmation', () => {
    it('completes with both-confirmed when the tenant confirms a landlord-recorded revision', async () => {
      const { service, id, outbox } = setup()
      const saved = await service.updateHandover(id, 'landlord', RECORD)
      const done = await service.confirmHandover(
        id,
        'tenant',
        'tenant',
        saved.handover!.handoverHash
      )
      expect(done.handover?.completedAt).toBeInstanceOf(Date)
      expect(done.handover?.completionReason).toBe('both-confirmed')
      expect(outbox.enqueue).toHaveBeenCalledTimes(1)
    })

    it('returns 403 when the confirming user does not hold the claimed role', async () => {
      const { service, id } = setup()
      const saved = await service.updateHandover(id, 'landlord', RECORD)
      await expect(
        service.confirmHandover(
          id,
          'stranger',
          'tenant',
          saved.handover!.handoverHash
        )
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('still confirms a legacy handover recorded before the new fields existed', async () => {
      const { service, id, row } = setup()
      const hash = 'a'.repeat(64)
      row.handover = {
        revision: 1,
        handedOverAt: new Date('2030-02-01'),
        meterReadings: { electricity: 1, water: 1 },
        keyCount: 1,
        inventoryReference: null,
        notes: null,
        handoverHash: hash,
        recordedBy: 'landlord',
        tenantConfirmation: null,
        landlordConfirmation: { at: new Date(), hash },
        discrepancyNote: 'legacy note',
        completedAt: null,
      }
      const done = await service.confirmHandover(id, 'tenant', 'tenant', hash)
      expect(done.handover?.completedAt).toBeInstanceOf(Date)
      expect(done.handover?.discrepancyNote).toBe('legacy note')
    })
  })

  describe('discrepancy (5.4)', () => {
    it('keeps the handover open, stores the note against the revision and notifies the landlord', async () => {
      const { service, id, notifications } = setup()
      const saved = await service.updateHandover(id, 'landlord', RECORD)
      notifications.createNotification.mockClear()
      const reported = await service.reportHandoverDiscrepancy(
        id,
        'tenant',
        saved.handover!.handoverHash,
        '  Chỉ số nước thực tế là 125  '
      )
      expect(reported.handover?.completedAt).toBeNull()
      expect(reported.handover?.tenantConfirmation).toBeNull()
      expect(reported.handover?.discrepancies).toEqual([
        {
          revision: 1,
          note: 'Chỉ số nước thực tế là 125',
          at: expect.any(Date) as Date,
        },
      ])
      expect(notifiedUsers(notifications.createNotification)).toEqual([
        'landlord',
      ])
    })

    it('rejects a stale hash, a landlord caller and a tenant that already confirmed', async () => {
      const { service, id } = setup()
      const saved = await service.updateHandover(id, 'staff-1', {
        ...RECORD,
        isStaff: true,
      })
      const hash = saved.handover!.handoverHash
      await expect(
        service.reportHandoverDiscrepancy(id, 'tenant', 'b'.repeat(64), 'x')
      ).rejects.toThrow('HANDOVER_REVISION_STALE')
      await expect(
        service.reportHandoverDiscrepancy(id, 'landlord', hash, 'x')
      ).rejects.toBeInstanceOf(ForbiddenException)
      await service.confirmHandover(id, 'tenant', 'tenant', hash)
      await expect(
        service.reportHandoverDiscrepancy(id, 'tenant', hash, 'x')
      ).rejects.toThrow('HANDOVER_ALREADY_CONFIRMED')
    })

    it('blocks tenant confirmation of a disputed revision until the landlord revises, and keeps every note', async () => {
      const { service, id } = setup()
      const first = await service.updateHandover(id, 'landlord', RECORD)
      const firstHash = first.handover!.handoverHash
      await service.reportHandoverDiscrepancy(
        id,
        'tenant',
        firstHash,
        'Nước 125'
      )
      await service.reportHandoverDiscrepancy(
        id,
        'tenant',
        firstHash,
        'Thiếu 1 chìa'
      )
      await expect(
        service.confirmHandover(id, 'tenant', 'tenant', firstHash)
      ).rejects.toThrow('HANDOVER_DISCREPANCY_OPEN')

      const second = await service.updateHandover(id, 'landlord', {
        ...RECORD,
        water: 125,
        keyCount: 1,
      })
      expect(second.handover?.revision).toBe(2)
      expect(second.handover?.discrepancies).toHaveLength(2)
      const done = await service.confirmHandover(
        id,
        'tenant',
        'tenant',
        second.handover!.handoverHash
      )
      expect(done.handover?.completionReason).toBe('both-confirmed')
    })
  })

  describe('response deadline (5.5, Q1 = tự hoàn tất)', () => {
    it('completes once with tenant-no-response after 3 days and enqueues one ledger item', async () => {
      const { service, id, row, outbox } = setup()
      await service.updateHandover(id, 'landlord', RECORD, T0)
      await expect(
        service.processHandoverResponseDeadlines(AFTER_DEADLINE)
      ).resolves.toBe(1)
      await expect(
        service.processHandoverResponseDeadlines(AFTER_DEADLINE)
      ).resolves.toBe(0)
      expect(row.handover?.completedAt).toEqual(AFTER_DEADLINE)
      expect(row.handover?.completionReason).toBe('tenant-no-response')
      expect(outbox.enqueue).toHaveBeenCalledTimes(1)
      const [input] = outbox.enqueue.mock.calls[0] as [{ args: string[] }]
      expect(input.args[3]).toBe('2')
    })

    it('does not complete before the deadline', async () => {
      const { service, id } = setup()
      await service.updateHandover(id, 'landlord', RECORD, T0)
      await expect(
        service.processHandoverResponseDeadlines(
          new Date('2030-02-04T09:59:59.999Z')
        )
      ).resolves.toBe(0)
    })

    it('does not complete a revision with an open discrepancy', async () => {
      const { service, id } = setup()
      const saved = await service.updateHandover(id, 'landlord', RECORD, T0)
      await service.reportHandoverDiscrepancy(
        id,
        'tenant',
        saved.handover!.handoverHash,
        'Sai chỉ số điện'
      )
      await expect(
        service.processHandoverResponseDeadlines(AFTER_DEADLINE)
      ).resolves.toBe(0)
    })

    it('does not complete a staff-recorded revision the landlord has not confirmed, nor a legacy handover without a deadline', async () => {
      const { service, id, row } = setup()
      await service.updateHandover(
        id,
        'staff-1',
        { ...RECORD, isStaff: true },
        T0
      )
      await expect(
        service.processHandoverResponseDeadlines(AFTER_DEADLINE)
      ).resolves.toBe(0)
      row.handover = {
        ...row.handover!,
        responseDueAt: null,
        landlordConfirmation: { at: T0, hash: row.handover!.handoverHash },
      }
      await expect(
        service.processHandoverResponseDeadlines(AFTER_DEADLINE)
      ).resolves.toBe(0)
    })
  })

  describe('notifications (5.6)', () => {
    it('notifies the tenant on record and both parties on completion', async () => {
      const { service, id, notifications } = setup()
      const saved = await service.updateHandover(id, 'landlord', RECORD, T0)
      expect(notifiedUsers(notifications.createNotification)).toEqual([
        'tenant',
      ])
      expect(notifications.createNotification.mock.calls[0]?.[3]).toBe(
        'MOVE_IN_HANDOVER'
      )
      notifications.createNotification.mockClear()
      await service.confirmHandover(
        id,
        'tenant',
        'tenant',
        saved.handover!.handoverHash
      )
      expect(notifiedUsers(notifications.createNotification)).toEqual([
        'tenant',
        'landlord',
      ])
    })

    it('mentions Điều 9.1 when completion is due to the deadline', async () => {
      const { service, id, notifications } = setup()
      await service.updateHandover(id, 'landlord', RECORD, T0)
      notifications.createNotification.mockClear()
      await service.processHandoverResponseDeadlines(AFTER_DEADLINE)
      const bodies = (
        notifications.createNotification.mock.calls as Array<
          [string, string, string]
        >
      ).map(call => call[2])
      expect(bodies).toHaveLength(2)
      expect(bodies[0]).toContain('Điều 9.1')
    })

    it('does not fail the handover when sending a notification fails', async () => {
      const { service, id, notifications } = setup()
      notifications.createNotification.mockRejectedValue(new Error('smtp down'))
      const saved = await service.updateHandover(id, 'landlord', RECORD)
      expect(saved.handover?.handoverHash).toMatch(/^[a-f0-9]{64}$/)
    })
  })
})

describe('move-in settlement persistence schema (PROP-399)', () => {
  it('persists optional settlement/handover ledger evidence so legacy documents without them stay valid', () => {
    const columnNames = getMetadataArgsStorage()
      .columns.filter(column => column.target === MoveInSettlement)
      .map(column =>
        typeof column.propertyName === 'string' ? column.propertyName : ''
      )
    expect(columnNames).toEqual(
      expect.arrayContaining(['settlementEvidence', 'handoverEvidence'])
    )

    const legacy = new MoveInSettlement()
    expect(legacy.settlementEvidence).toBeUndefined()
    expect(legacy.handoverEvidence).toBeUndefined()

    legacy.settlementEvidence = {
      manifestVersion: 1,
      manifestHash: 'a'.repeat(64),
      ledgerStatus: 'pending',
      txHash: null,
      blockNumber: null,
      recordedAt: new Date('2030-01-01'),
    }
    expect(legacy.settlementEvidence.manifestHash).toHaveLength(64)
  })
})
