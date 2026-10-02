import { ObjectId } from 'mongodb'
import { MoveInSettlementsService } from './move-in-settlements.service'
import type { Contract } from '../contracts/schemas/contract.schema'
import type { Payment } from '../payments/schemas/payment.schema'

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

  it('reuses an existing settlement and skips legacy contracts without a policy or fee', async () => {
    const { service, settlementRepo, paymentRepo } = setup()
    settlementRepo.findOne.mockResolvedValue({ contractId: 'existing' })
    await expect(
      service.createForContract({
        _id: { toHexString: () => 'existing' },
      } as Contract)
    ).resolves.toEqual({ contractId: 'existing' })
    settlementRepo.findOne.mockResolvedValue(null)
    await expect(
      service.createForContract({
        _id: { toHexString: () => 'legacy' },
      } as Contract)
    ).resolves.toBeNull()
    expect(paymentRepo.find).not.toHaveBeenCalled()
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
})
