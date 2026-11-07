import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { Contract } from '../../contracts/schemas/contract.schema'
import { Payment } from '../schemas/payment.schema'
import type { PlatformFeeScheduleRepository } from '../utils/platform-fee-schedule.repository'
import { PaymentsService, type PaymentView } from './payments.service'
import type { NotificationsService } from '../../notifications/services/notifications.service'
import type { LedgerOutboxService } from '../../fabric/services/ledger-outbox.service'
import { RentalTransactionEventService } from '../../rental/services/rental-transaction-event.service'
import type { RentalTransactionEvent } from '../../rental/schemas/rental-transaction-event.schema'

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

describe('PaymentsService', () => {
  const paymentRepository = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  }
  const contractRepository = { findOne: jest.fn() }
  const ledgerOutboxService = { enqueue: jest.fn().mockResolvedValue({}) }
  const service = new PaymentsService(
    paymentRepository as unknown as Repository<Payment>,
    contractRepository as unknown as Repository<Contract>,
    undefined,
    ledgerOutboxService as unknown as LedgerOutboxService
  )

  beforeEach(() => jest.clearAllMocks())

  it('generates one unpaid invoice per contract period', async () => {
    paymentRepository.find.mockResolvedValue([])
    paymentRepository.create.mockImplementation(
      (value: Payment): Payment => value
    )
    paymentRepository.save.mockImplementation(
      (value: Payment): Promise<Payment> => Promise.resolve(value)
    )

    const result = await service.generateSchedule({
      _id: new ObjectId(),
      startDate: new Date('2030-01-01T00:00:00.000Z'),
      durationMonths: 2,
      monthlyRent: 10_000_000,
      paymentDay: 31,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
    } as Contract)

    expect(result).toHaveLength(2)
    expect(result[1]?.periodKey).toBe('2030-02')
    expect(paymentRepository.save).toHaveBeenCalledTimes(2)
  })

  it('creates one rent invoice per configured payment cycle', async () => {
    paymentRepository.find.mockResolvedValue([])
    paymentRepository.create.mockImplementation(
      (value: Payment): Payment => value
    )
    paymentRepository.save.mockImplementation(
      (value: Payment): Promise<Payment> => Promise.resolve(value)
    )

    const contract = Object.assign(
      {
        _id: new ObjectId(),
        startDate: new Date('2030-01-01T00:00:00.000Z'),
        durationMonths: 12,
        monthlyRent: 10_000_000,
        paymentDay: 10,
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
      } as Contract,
      { paymentCycleMonths: 3 }
    )
    const result = await service.generateSchedule(contract)

    expect(result).toHaveLength(4)
    expect(paymentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 30_000_000,
        periodKey: '2030-01',
        cycleMonths: 3,
        periodStart: new Date('2030-01-01T00:00:00.000Z'),
        periodEnd: new Date('2030-03-31T00:00:00.000Z'),
      })
    )
  })

  it('merges prepaid months into the first invoice when the contract records a prepayment', async () => {
    paymentRepository.find.mockResolvedValue([])
    paymentRepository.create.mockImplementation(
      (value: Payment): Payment => value
    )
    paymentRepository.save.mockImplementation(
      (value: Payment): Promise<Payment> => Promise.resolve(value)
    )
    const contract = {
      _id: new ObjectId(),
      startDate: new Date('2030-01-01T00:00:00.000Z'),
      durationMonths: 6,
      monthlyRent: 10_000_000,
      paymentDay: 5,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      prepaidRentMonths: 6,
    } as Contract

    const result = await service.generateSchedule(contract)

    expect(result).toHaveLength(1)
    expect(paymentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 60_000_000,
        periodKey: '2030-01',
        periodEnd: new Date('2030-06-30T00:00:00.000Z'),
      })
    )
  })

  it('keeps one invoice per period for legacy contracts without a prepayment record', async () => {
    paymentRepository.find.mockResolvedValue([])
    paymentRepository.create.mockImplementation(
      (value: Payment): Payment => value
    )
    paymentRepository.save.mockImplementation(
      (value: Payment): Promise<Payment> => Promise.resolve(value)
    )

    const result = await service.generateSchedule({
      _id: new ObjectId(),
      startDate: new Date('2030-01-01T00:00:00.000Z'),
      durationMonths: 3,
      monthlyRent: 10_000_000,
      paymentDay: 5,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      prepaidRentMonths: null,
    } as Contract)

    expect(result).toHaveLength(3)
  })

  it('uses locked effective commercial terms when generating rent invoices', async () => {
    paymentRepository.find.mockResolvedValue([])
    paymentRepository.create.mockImplementation(
      (value: Payment): Payment => value
    )
    paymentRepository.save.mockImplementation(
      (value: Payment): Promise<Payment> => Promise.resolve(value)
    )
    const contract = {
      _id: new ObjectId(),
      startDate: new Date('2030-01-01T00:00:00.000Z'),
      durationMonths: 12,
      monthlyRent: 10_000_000,
      paymentDay: 1,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      contentLockedAt: new Date(),
      commercialDraft: {
        monthlyRent: 12_000_000,
        deposit: 24_000_000,
        paymentDay: 5,
        latePenaltyRate: 0,
        terminationNoticeDays: 30,
        durationMonths: 12,
      },
    } as Contract

    await service.generateSchedule(contract)

    expect(paymentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 12_000_000,
      })
    )
  })

  it('rejects a non-participant from reading a contract schedule', async () => {
    contractRepository.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
    })

    await expect(
      service.getByContract('507f1f77bcf86cd799439011', 'outsider', false)
    ).rejects.toThrow(ForbiddenException)
  })

  it('delegates access checks to the OwnershipTransferResolver resolved via ModuleRef when available', async () => {
    const contract = { tenantId: 'tenant-1', landlordId: 'landlord-1' }
    contractRepository.findOne.mockResolvedValue(contract)
    paymentRepository.find.mockResolvedValue([])
    const ownershipTransferResolver = {
      canAccessPayment: jest.fn().mockResolvedValue(true),
    }
    const moduleRef = {
      get: jest.fn().mockReturnValue(ownershipTransferResolver),
    }
    const serviceWithModuleRef = new PaymentsService(
      paymentRepository as unknown as Repository<Payment>,
      contractRepository as unknown as Repository<Contract>,
      undefined,
      undefined,
      undefined,
      undefined,
      moduleRef as unknown as import('@nestjs/core').ModuleRef
    )

    await serviceWithModuleRef.getByContract(
      '507f1f77bcf86cd799439011',
      'successor-landlord',
      false
    )

    expect(moduleRef.get).toHaveBeenCalled()
    expect(ownershipTransferResolver.canAccessPayment).toHaveBeenCalledWith(
      'successor-landlord',
      { landlordId: 'landlord-1', tenantId: 'tenant-1' },
      contract,
      false
    )
  })

  it('falls back to the default participant check when ModuleRef cannot resolve an OwnershipTransferResolver', async () => {
    const contract = { tenantId: 'tenant-1', landlordId: 'landlord-1' }
    contractRepository.findOne.mockResolvedValue(contract)
    paymentRepository.find.mockResolvedValue([])
    const moduleRef = { get: jest.fn().mockReturnValue(undefined) }
    const serviceWithModuleRef = new PaymentsService(
      paymentRepository as unknown as Repository<Payment>,
      contractRepository as unknown as Repository<Contract>,
      undefined,
      undefined,
      undefined,
      undefined,
      moduleRef as unknown as import('@nestjs/core').ModuleRef
    )

    await expect(
      serviceWithModuleRef.getByContract(
        '507f1f77bcf86cd799439011',
        'tenant-1',
        false
      )
    ).resolves.toEqual([])

    await expect(
      serviceWithModuleRef.getByContract(
        '507f1f77bcf86cd799439011',
        'outsider',
        false
      )
    ).rejects.toThrow(ForbiddenException)
  })

  describe('provisional late interest on getByContract', () => {
    const contract = {
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      latePenaltyRate: 12,
    }
    const read = async (rows: Partial<Payment>[]): Promise<PaymentView[]> => {
      contractRepository.findOne.mockResolvedValue(contract)
      paymentRepository.find.mockResolvedValue(rows)
      return service.getByContract(
        '507f1f77bcf86cd799439011',
        'tenant-1',
        false
      )
    }

    afterEach(() => jest.useRealTimers())

    it('shows days late and provisional interest for an overdue rent invoice, without storing anything', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2030-03-06T05:00:00+07:00'))
      const overdue = {
        type: 'rent',
        status: 'overdue',
        amount: 6_000_000,
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        dueDate: new Date('2030-03-01T00:00:00+07:00'),
      } as Payment

      const [item] = await read([overdue])

      expect(item).toMatchObject({ daysLate: 5, accruedLateInterest: 9_863 })
      expect(paymentRepository.save).not.toHaveBeenCalled()
      expect(overdue).not.toHaveProperty('accruedLateInterest')
    })

    it('returns null for an invoice that is not yet overdue and for non-rent invoices', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2030-03-06T05:00:00+07:00'))
      const base = {
        amount: 6_000_000,
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        dueDate: new Date('2030-03-01T00:00:00+07:00'),
      }
      const items = await read([
        { ...base, type: 'rent', status: 'unpaid' },
        { ...base, type: 'penalty', status: 'overdue' },
        { ...base, type: 'rent', status: 'paid' },
      ] as Payment[])

      for (const item of items) {
        expect(item).toMatchObject({
          daysLate: null,
          accruedLateInterest: null,
        })
      }
    })

    it('shows days late but no interest when the contract has no late-payment interest', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2030-03-06T05:00:00+07:00'))
      contract.latePenaltyRate = 0
      try {
        const [item] = await read([
          {
            type: 'rent',
            status: 'overdue',
            amount: 6_000_000,
            tenantId: 'tenant-1',
            landlordId: 'landlord-1',
            dueDate: new Date('2030-03-01T00:00:00+07:00'),
          },
        ])
        expect(item).toMatchObject({ daysLate: 5 })
        // Structured layout prints 10 for a 0 rate, so interest still applies there.
        expect(item?.accruedLateInterest).toBe(8_219)
      } finally {
        contract.latePenaltyRate = 12
      }
    })
  })

  it('normalizes legacy rent invoices to tenant payer and landlord payee', async () => {
    const legacy = {
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      payerId: null,
      payerRole: null,
      payeeRole: null,
    } as Payment
    contractRepository.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
    })
    paymentRepository.find.mockResolvedValue([legacy])

    const payments = await service.getByContract(
      '507f1f77bcf86cd799439011',
      'tenant-1',
      false
    )

    expect(payments[0]).toEqual(
      expect.objectContaining({
        payerId: 'tenant-1',
        payerRole: 'tenant',
        payeeRole: 'landlord',
      })
    )
  })

  it('returns a platform-fee invoice only to its payer or staff', async () => {
    const rent = {
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      type: 'rent',
    } as Payment
    const landlordFee = {
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      payerId: 'landlord-1',
      payerRole: 'landlord',
      payeeRole: 'platform',
      type: 'platform-fee',
    } as Payment
    contractRepository.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
    })
    paymentRepository.find.mockResolvedValue([rent, landlordFee])

    const tenantPayments = await service.getByContract(
      '507f1f77bcf86cd799439011',
      'tenant-1',
      false
    )
    const landlordPayments = await service.getByContract(
      '507f1f77bcf86cd799439011',
      'landlord-1',
      false
    )

    expect(tenantPayments).toEqual([expect.objectContaining({ type: 'rent' })])
    expect(landlordPayments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'rent' }),
        expect.objectContaining({
          type: 'platform-fee',
          payerId: 'landlord-1',
        }),
      ])
    )
  })

  it('confirms an unpaid payment once and records the actor', async () => {
    const payment: Payment = {
      _id: new ObjectId(),
      contractId: 'contract-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      amount: 10_000_000,
      description: 'January rent',
      dueDate: new Date('2030-01-31T00:00:00.000Z'),
      paidAt: null,
      status: 'unpaid',
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    paymentRepository.findOne.mockResolvedValue(payment)
    paymentRepository.save.mockImplementation(
      (value: Payment): Promise<Payment> => Promise.resolve(value)
    )
    const payoutsService = { createForPayment: jest.fn().mockResolvedValue({}) }
    Reflect.set(service, 'payoutsService', payoutsService)

    const result = await service.confirmPayment(
      payment._id.toString(),
      'staff-1',
      true
    )

    expect(result.status).toBe('paid')
    expect(result.confirmedBy).toBe('staff-1')
    expect(result.ledgerStatus).toBe('pending')
    expect(ledgerOutboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recordPayment',
        dependencyKey: 'contract:contract-1:contract.activated',
        args: [
          payment._id.toHexString(),
          'contract-1',
          '10000000',
          expect.stringMatching(/^[a-f0-9]{64}$/),
        ],
      })
    )
    expect(payoutsService.createForPayment).toHaveBeenCalledWith({
      paymentId: payment._id.toHexString(),
      contractId: 'contract-1',
      landlordId: 'landlord-1',
      amount: 10_000_000,
    })

    await service.confirmPayment(payment._id.toString(), 'staff-1', true)
    expect(payoutsService.createForPayment).toHaveBeenCalledTimes(1)
  })

  describe('late penalty assessment on confirmation', () => {
    const buildPayment = (): Record<string, unknown> => ({
      _id: new ObjectId(),
      contractId: 'contract-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      amount: 10_000_000,
      description: 'Rent',
      dueDate: new Date('2030-01-05T00:00:00.000Z'),
      paidAt: null,
      status: 'unpaid',
      type: 'rent',
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    afterEach(() => {
      Reflect.set(service, 'latePenaltyService', undefined)
    })

    it('assesses the paid rent invoice once, and not again on a repeated confirmation', async () => {
      const payment = buildPayment()
      paymentRepository.findOne.mockResolvedValue(payment)
      paymentRepository.save.mockImplementation(
        (value: Payment): Promise<Payment> => Promise.resolve(value)
      )
      const latePenaltyService = {
        assessForPaidRent: jest.fn().mockResolvedValue(null),
      }
      Reflect.set(service, 'latePenaltyService', latePenaltyService)

      await service.confirmPayment(
        (payment._id as ObjectId).toString(),
        'staff-1',
        true
      )
      await service.confirmPayment(
        (payment._id as ObjectId).toString(),
        'staff-1',
        true
      )

      expect(latePenaltyService.assessForPaidRent).toHaveBeenCalledTimes(1)
      expect(latePenaltyService.assessForPaidRent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'paid' })
      )
    })

    it('keeps the payment paid when the assessment fails', async () => {
      const payment = buildPayment()
      paymentRepository.findOne.mockResolvedValue(payment)
      paymentRepository.save.mockImplementation(
        (value: Payment): Promise<Payment> => Promise.resolve(value)
      )
      Reflect.set(service, 'latePenaltyService', {
        assessForPaidRent: jest.fn().mockRejectedValue(new Error('db down')),
      })

      const result = await service.confirmPayment(
        (payment._id as ObjectId).toString(),
        'staff-1',
        true
      )

      expect(result.status).toBe('paid')
      expect(ledgerOutboxService.enqueue).toHaveBeenCalled()
    })
  })

  it.each([
    [2, 'rent', 4],
    [3, 'rent', 5],
    [3, 'penalty', 5],
  ] as const)(
    'confirmPayment on chaincode ABI %i sends recordPayment for a %s invoice with %i args',
    async (abiVersion, type, argCount) => {
      const payment = {
        _id: new ObjectId(),
        contractId: 'contract-1',
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        amount: 10_000_000,
        description: 'Rent',
        dueDate: new Date('2030-01-31T00:00:00.000Z'),
        periodStart: new Date('2030-01-01T00:00:00.000Z'),
        paidAt: null,
        status: 'unpaid',
        type,
        txHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      paymentRepository.findOne.mockResolvedValue(payment)
      paymentRepository.save.mockImplementation(
        (value: Payment): Promise<Payment> => Promise.resolve(value)
      )
      Reflect.set(service, 'fabricService', {
        getChaincodeAbiVersion: () => abiVersion,
      })
      try {
        await service.confirmPayment(payment._id.toString(), 'staff-1', true)
      } finally {
        Reflect.set(service, 'fabricService', undefined)
      }

      const call = ledgerOutboxService.enqueue.mock.calls.at(-1)?.[0] as {
        args: string[]
      }
      expect(call.args).toHaveLength(argCount)
      if (argCount === 5) {
        expect(call.args[4]).toBe(
          type === 'rent' ? '2030-01-01T00:00:00.000Z' : ''
        )
      }
    }
  )

  it('keeps a confirmed payment successful when payout creation fails', async () => {
    const payment = {
      _id: new ObjectId(),
      contractId: 'contract-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      amount: 10_000_000,
      status: 'unpaid',
      paidAt: null,
      dueDate: new Date('2030-01-31T00:00:00.000Z'),
    } as Payment
    paymentRepository.findOne.mockResolvedValue(payment)
    paymentRepository.save.mockImplementation(
      (value: Payment): Promise<Payment> => Promise.resolve(value)
    )
    Reflect.set(service, 'payoutsService', {
      createForPayment: jest.fn().mockRejectedValue(new Error('payout down')),
    })

    await expect(
      service.confirmPayment(payment._id.toHexString(), 'staff-1', true)
    ).resolves.toMatchObject({ status: 'paid' })
  })

  it('returns not found for an invalid payment id', async () => {
    await expect(
      service.confirmPayment('bad-id', 'staff-1', true)
    ).rejects.toThrow(NotFoundException)
  })

  it('marks unpaid invoices overdue and sends one Vietnam-timezone reminder', async () => {
    const notificationService = {
      createNotification: jest.fn().mockResolvedValue({}),
    }
    const reminderService = new PaymentsService(
      paymentRepository as unknown as Repository<Payment>,
      contractRepository as unknown as Repository<Contract>,
      notificationService as unknown as NotificationsService
    )
    const reminderPayment = {
      _id: new ObjectId(),
      contractId: 'contract-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      amount: 10_000_000,
      description: 'March rent',
      periodKey: '2030-03',
      dueDate: new Date('2030-03-10T00:00:00.000Z'),
      status: 'unpaid' as const,
      reminderSentForDate: null,
      reminderSentAt: null,
    } as Payment
    paymentRepository.find.mockResolvedValue([reminderPayment])
    paymentRepository.save.mockImplementation(
      (value: Payment): Promise<Payment> => Promise.resolve(value)
    )

    await expect(
      reminderService.processReminders(new Date('2030-03-03T01:00:00.000Z'))
    ).resolves.toEqual({ overdue: 0, reminders: 1 })
    expect(notificationService.createNotification).toHaveBeenCalledWith(
      'tenant-1',
      'Rent payment reminder',
      expect.stringContaining('2030-03-10'),
      'PAYMENT_REMINDER',
      expect.objectContaining({ paymentId: reminderPayment._id.toString() })
    )
    expect(reminderPayment.reminderSentForDate).toBe('2030-03-03')

    notificationService.createNotification.mockClear()
    await expect(
      reminderService.processReminders(new Date('2030-03-03T04:00:00.000Z'))
    ).resolves.toEqual({ overdue: 0, reminders: 0 })
    expect(notificationService.createNotification).not.toHaveBeenCalled()
  })

  it('marks past unpaid invoices overdue without sending a reminder', async () => {
    const overduePayment = {
      _id: new ObjectId(),
      contractId: 'contract-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      dueDate: new Date('2030-02-01T00:00:00.000Z'),
      status: 'unpaid' as const,
      reminderSentForDate: null,
    } as Payment
    paymentRepository.find.mockResolvedValue([overduePayment])
    paymentRepository.save.mockImplementation(
      (value: Payment): Promise<Payment> => Promise.resolve(value)
    )

    await expect(
      service.processReminders(new Date('2030-02-10T00:00:00.000Z'))
    ).resolves.toEqual({ overdue: 1, reminders: 0 })
    expect(overduePayment.status).toBe('overdue')
  })

  it('records exactly one fee.issued transaction event when invoice generation is retried', async () => {
    const { service: transactionEventService, events } =
      createInMemoryTransactionEventService()
    Reflect.set(service, 'transactionEventService', transactionEventService)
    const contract = {
      _id: new ObjectId(),
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      feeSnapshot: {
        scheduleId: 'fee-v1',
        version: 1,
        contentHash: 'a'.repeat(64),
        quote: [
          {
            feeKind: 'TENANT_SERVICE' as const,
            payerRole: 'tenant' as const,
            amountBeforeVat: 200_000,
            vatAmount: 20_000,
            amount: 220_000,
          },
        ],
      },
    } as unknown as Contract
    paymentRepository.create.mockImplementation(
      (value: Payment): Payment => value
    )
    paymentRepository.save.mockImplementation(
      (value: Payment): Promise<Payment> =>
        Promise.resolve({ ...value, _id: value._id ?? new ObjectId() })
    )

    paymentRepository.findOne.mockResolvedValueOnce(null)
    const [created] = await service.generatePlatformFeeInvoices(contract)

    // Retry: the invoice now exists, so the service must reuse it and must
    // not emit a second fee.issued event for the same invoice.
    paymentRepository.findOne.mockResolvedValueOnce(created)
    await service.generatePlatformFeeInvoices(contract)

    const issuedEvents = events.filter(
      event => event.eventType === 'fee.issued'
    )
    expect(issuedEvents).toHaveLength(1)
  })

  describe('landlord commission invoice', () => {
    const contract = {
      _id: new ObjectId(),
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      feeSnapshot: {
        scheduleId: 'fee-v1',
        version: 1,
        contentHash: 'a'.repeat(64),
        quote: [
          {
            feeKind: 'LANDLORD_COMMISSION' as const,
            payerRole: 'landlord' as const,
            amountBeforeVat: 1_000_000,
            vatAmount: 100_000,
            amount: 1_100_000,
          },
        ],
      },
    } as unknown as Contract
    const scheduleRepo = {
      findOne: jest.fn(),
    }
    const notifications = {
      createNotification: jest.fn().mockResolvedValue({}),
      createNotificationOnce: jest.fn().mockResolvedValue({}),
    }
    function build(): PaymentsService {
      return new PaymentsService(
        paymentRepository as unknown as Repository<Payment>,
        contractRepository as unknown as Repository<Contract>,
        notifications as unknown as NotificationsService,
        undefined,
        undefined,
        undefined,
        undefined,
        scheduleRepo as unknown as PlatformFeeScheduleRepository
      )
    }
    beforeEach(() => {
      scheduleRepo.findOne.mockResolvedValue({
        rules: { landlordCommission: { dueDaysAfterActivation: 15 } },
      })
      paymentRepository.create.mockImplementation(
        (value: Payment): Payment => value
      )
      paymentRepository.save.mockImplementation(
        (value: Payment): Promise<Payment> =>
          Promise.resolve({ ...value, _id: value._id ?? new ObjectId() })
      )
    })

    it('uses dueDaysAfterActivation and notifies the landlord once', async () => {
      paymentRepository.findOne.mockResolvedValueOnce(null)
      const before = Date.now()
      const [invoice] = await build().generatePlatformFeeInvoices(contract)
      const days = (invoice!.dueDate.getTime() - before) / 86_400_000
      expect(days).toBeGreaterThan(14.9)
      expect(days).toBeLessThan(15.1)
      expect(notifications.createNotificationOnce).toHaveBeenCalledWith(
        'landlord-1',
        `fee:${invoice!._id.toHexString()}:issued`,
        'Phí hoa hồng cần thanh toán',
        expect.stringContaining('VND'),
        'PLATFORM_FEE_INVOICE',
        expect.objectContaining({
          amount: 1_100_000,
          link: '/profile?tab=wallet',
        })
      )

      notifications.createNotificationOnce.mockClear()
      paymentRepository.findOne.mockResolvedValueOnce(invoice)
      await build().generatePlatformFeeInvoices(contract)
      expect(notifications.createNotificationOnce).not.toHaveBeenCalled()
    })

    it('falls back to 7 days and swallows notification failures', async () => {
      scheduleRepo.findOne.mockResolvedValueOnce(null)
      notifications.createNotificationOnce.mockRejectedValueOnce(new Error('x'))
      paymentRepository.findOne.mockResolvedValueOnce(null)
      const before = Date.now()
      const [invoice] = await build().generatePlatformFeeInvoices(contract)
      const days = (invoice!.dueDate.getTime() - before) / 86_400_000
      expect(days).toBeGreaterThan(6.9)
      expect(days).toBeLessThan(7.1)
    })

    it('sends the reminder for a landlord-payer fee invoice to the landlord', async () => {
      const payment = {
        _id: new ObjectId(),
        contractId: 'c',
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        payerId: 'landlord-1',
        payerRole: 'landlord',
        type: 'platform-fee',
        periodKey: 'FEE:LANDLORD_COMMISSION',
        dueDate: new Date('2030-03-10T00:00:00.000Z'),
        status: 'unpaid' as const,
        reminderSentForDate: null,
      } as Payment
      paymentRepository.find.mockResolvedValue([payment])
      await build().processReminders(new Date('2030-03-03T01:00:00.000Z'))
      expect(notifications.createNotification).toHaveBeenCalledWith(
        'landlord-1',
        expect.anything(),
        expect.anything(),
        'PAYMENT_REMINDER',
        expect.anything()
      )
    })
  })
})

describe('PaymentsService overdue escalation (rental-payments delta spec)', () => {
  interface Context {
    service: PaymentsService
    rows: Payment[]
    notifications: {
      createNotificationOnce: jest.Mock
      createNotification: jest.Mock
    }
  }

  function build(rows: Payment[]): Context {
    const paymentRepository = {
      find: jest.fn(
        ({ where }: { where: Record<string, unknown> }): Promise<Payment[]> =>
          Promise.resolve(
            rows.filter(row =>
              Object.entries(where).every(([key, value]) =>
                value === null
                  ? !(row as unknown as Record<string, unknown>)[key]
                  : (row as unknown as Record<string, unknown>)[key] === value
              )
            )
          )
      ),
      save: jest.fn(
        (value: Payment): Promise<Payment> => Promise.resolve(value)
      ),
    }
    const notifications = {
      createNotificationOnce: jest.fn().mockResolvedValue({}),
      createNotification: jest.fn().mockResolvedValue({}),
    }
    const service = new PaymentsService(
      paymentRepository as unknown as Repository<Payment>,
      { findOne: jest.fn() } as unknown as Repository<Contract>,
      notifications as unknown as NotificationsService
    )
    return { service, rows, notifications }
  }

  function invoice(overrides: Record<string, unknown> = {}): Payment {
    return {
      _id: new ObjectId(),
      contractId: 'contract-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      amount: 10_000_000,
      periodKey: '2026-11',
      dueDate: new Date('2026-11-05T00:00:00+07:00'),
      status: 'unpaid',
      type: 'rent',
      reminderSentForDate: null,
      overdueNoticeSentAt: null,
      terminationRightNotifiedAt: null,
      ...overrides,
    } as unknown as Payment
  }

  const at = (iso: string): Date => new Date(iso)
  const sent = (ctx: Context): Array<[string, string, string]> =>
    (
      ctx.notifications.createNotificationOnce.mock.calls as Array<string[]>
    ).map(call => [call[0], call[1], call[4]] as [string, string, string])

  it('marks a rent invoice overdue on D+1 and sends the tenant exactly one overdue notice, even when the job reruns', async () => {
    const rent = invoice()
    const ctx = build([rent])

    await expect(
      ctx.service.processReminders(at('2026-11-06T07:00:00+07:00'))
    ).resolves.toEqual({ overdue: 1, reminders: 0 })
    await ctx.service.processReminders(at('2026-11-06T07:00:00+07:00'))
    await ctx.service.processReminders(at('2026-11-06T19:00:00+07:00'))

    expect(rent.status).toBe('overdue')
    expect(rent.overdueNoticeSentAt).toEqual(at('2026-11-06T07:00:00+07:00'))
    expect(sent(ctx)).toEqual([
      ['tenant-1', `rent:${rent._id.toHexString()}:overdue`, 'PAYMENT_OVERDUE'],
    ])
    expect(rent.terminationRightNotifiedAt).toBeNull()
  })

  it('does not yet announce the termination right at exactly 15 days late', async () => {
    const rent = invoice({ status: 'overdue' })
    const ctx = build([rent])

    await ctx.service.processReminders(at('2026-11-20T07:00:00+07:00'))

    expect(sent(ctx).map(entry => entry[2])).toEqual(['PAYMENT_OVERDUE'])
    expect(rent.terminationRightNotifiedAt).toBeNull()
  })

  it('tells tenant and landlord once that the landlord may terminate after more than 15 days, and never changes the contract', async () => {
    const rent = invoice({
      status: 'overdue',
      overdueNoticeSentAt: at('2026-11-06T07:00:00+07:00'),
    })
    const ctx = build([rent])

    await ctx.service.processReminders(at('2026-11-21T07:00:00+07:00'))
    await ctx.service.processReminders(at('2026-11-22T07:00:00+07:00'))

    const termination = sent(ctx).filter(
      entry => entry[2] === 'LEASE_TERMINATION_RIGHT'
    )
    expect(termination.map(entry => entry[0]).sort()).toEqual([
      'landlord-1',
      'tenant-1',
    ])
    expect(rent.terminationRightNotifiedAt).toEqual(
      at('2026-11-21T07:00:00+07:00')
    )
    const body = (
      ctx.notifications.createNotificationOnce.mock.calls as string[][]
    ).find(call => call[4] === 'LEASE_TERMINATION_RIGHT')?.[3]
    expect(body).toContain('không tự chấm dứt')
  })

  it('sends both notices in one run when the first run already finds the invoice more than 15 days late', async () => {
    const rent = invoice()
    const ctx = build([rent])

    await ctx.service.processReminders(at('2026-11-25T07:00:00+07:00'))

    expect(
      sent(ctx)
        .map(entry => entry[2])
        .sort()
    ).toEqual([
      'LEASE_TERMINATION_RIGHT',
      'LEASE_TERMINATION_RIGHT',
      'PAYMENT_OVERDUE',
    ])
  })

  it.each(['penalty', 'deposit-topup', 'platform-fee'] as const)(
    'marks a %s invoice overdue without any overdue or termination notice',
    async type => {
      const other = invoice({ type })
      const ctx = build([other])

      await ctx.service.processReminders(at('2026-11-30T07:00:00+07:00'))

      expect(other.status).toBe('overdue')
      expect(ctx.notifications.createNotificationOnce).not.toHaveBeenCalled()
      expect(other.overdueNoticeSentAt).toBeNull()
      expect(other.terminationRightNotifiedAt).toBeNull()
    }
  )

  it('keeps processing other invoices when one notification fails', async () => {
    const first = invoice({ status: 'overdue' })
    const second = invoice({ status: 'overdue', periodKey: '2026-10' })
    const ctx = build([first, second])
    ctx.notifications.createNotificationOnce.mockRejectedValueOnce(
      new Error('push down')
    )

    await ctx.service.processReminders(at('2026-11-06T07:00:00+07:00'))

    expect(first.overdueNoticeSentAt).toBeNull()
    expect(second.overdueNoticeSentAt).not.toBeNull()
  })
})

describe('PaymentsService.waivePenalty', () => {
  const PENALTY_ID = new ObjectId()

  interface WaiveContext {
    service: PaymentsService
    penalty: Payment
    notifications: { createNotificationOnce: jest.Mock }
    events: { record: jest.Mock }
    repository: { findOne: jest.Mock; save: jest.Mock }
  }

  function build(penaltyOverrides: Record<string, unknown> = {}): WaiveContext {
    const penalty = {
      _id: PENALTY_ID,
      contractId: '507f1f77bcf86cd799439011',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      amount: 27_397,
      type: 'penalty',
      status: 'unpaid',
      ...penaltyOverrides,
    } as unknown as Payment
    const repository = {
      findOne: jest.fn().mockResolvedValue(penalty),
      save: jest.fn(
        (value: Payment): Promise<Payment> => Promise.resolve(value)
      ),
    }
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
      }),
    }
    const notifications = {
      createNotificationOnce: jest.fn().mockResolvedValue({}),
    }
    const events = { record: jest.fn().mockResolvedValue({}) }
    const service = new PaymentsService(
      repository as unknown as Repository<Payment>,
      contractRepository as unknown as Repository<Contract>,
      notifications as unknown as NotificationsService,
      undefined,
      events as never
    )
    return { service, penalty, notifications, events, repository }
  }

  it('waives an unpaid penalty with a reason, records the event and notifies the tenant', async () => {
    const { service, penalty, notifications, events } = build()

    const result = await service.waivePenalty(
      PENALTY_ID.toHexString(),
      'landlord-1',
      '  Khách thuê gặp khó khăn  '
    )

    expect(result.status).toBe('waived')
    expect(result.waivedBy).toBe('landlord-1')
    expect(result.waiveReason).toBe('Khách thuê gặp khó khăn')
    expect(result.waivedAt).toBeInstanceOf(Date)
    expect(penalty.status).toBe('waived')
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'penalty.waived',
        actorRole: 'landlord',
        transitionKey: `penalty:${PENALTY_ID.toHexString()}:waived`,
      })
    )
    expect(notifications.createNotificationOnce).toHaveBeenCalledWith(
      'tenant-1',
      expect.stringContaining('waived'),
      expect.any(String),
      expect.stringContaining('Khách thuê gặp khó khăn'),
      'LATE_PENALTY_WAIVED',
      expect.objectContaining({ paymentId: PENALTY_ID.toHexString() })
    )
  })

  it('also waives an overdue penalty', async () => {
    const { service } = build({ status: 'overdue' })
    const result = await service.waivePenalty(
      PENALTY_ID.toHexString(),
      'landlord-1',
      'ok'
    )
    expect(result.status).toBe('waived')
  })

  it('rejects an already paid penalty with PENALTY_ALREADY_PAID and changes nothing', async () => {
    const { service, penalty, repository } = build({ status: 'paid' })
    await expect(
      service.waivePenalty(PENALTY_ID.toHexString(), 'landlord-1', 'ok')
    ).rejects.toThrow('PENALTY_ALREADY_PAID')
    expect(penalty.status).toBe('paid')
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('rejects anyone who is not the landlord of the contract with PAYMENT_ACCESS_DENIED', async () => {
    const { service, repository } = build()
    for (const actor of ['tenant-1', 'landlord-2']) {
      await expect(
        service.waivePenalty(PENALTY_ID.toHexString(), actor, 'ok')
      ).rejects.toThrow('PAYMENT_ACCESS_DENIED')
    }
    expect(repository.save).not.toHaveBeenCalled()
  })

  it.each(['', '   ', undefined])(
    'rejects a missing reason (%j) with PENALTY_WAIVE_REASON_REQUIRED',
    async reason => {
      const { service, penalty, repository } = build()
      await expect(
        service.waivePenalty(
          PENALTY_ID.toHexString(),
          'landlord-1',
          reason as string
        )
      ).rejects.toThrow('PENALTY_WAIVE_REASON_REQUIRED')
      expect(penalty.status).toBe('unpaid')
      expect(repository.save).not.toHaveBeenCalled()
    }
  )

  it('returns an already waived penalty without a new event or notification', async () => {
    const { service, penalty, notifications, events, repository } = build({
      status: 'waived',
      waiveReason: 'lần đầu',
    })
    const result = await service.waivePenalty(
      PENALTY_ID.toHexString(),
      'landlord-1',
      'lý do khác'
    )
    expect(result).toBe(penalty)
    expect(result.waiveReason).toBe('lần đầu')
    expect(repository.save).not.toHaveBeenCalled()
    expect(events.record).not.toHaveBeenCalled()
    expect(notifications.createNotificationOnce).not.toHaveBeenCalled()
  })

  it('answers PAYMENT_NOT_FOUND for an invalid id, a missing invoice or a non-penalty invoice', async () => {
    const { service, repository } = build({ type: 'rent' })
    await expect(
      service.waivePenalty('not-an-id', 'landlord-1', 'ok')
    ).rejects.toThrow('PAYMENT_NOT_FOUND')
    await expect(
      service.waivePenalty(PENALTY_ID.toHexString(), 'landlord-1', 'ok')
    ).rejects.toThrow('PAYMENT_NOT_FOUND')
    repository.findOne.mockResolvedValue(null)
    await expect(
      service.waivePenalty(new ObjectId().toHexString(), 'landlord-1', 'ok')
    ).rejects.toThrow('PAYMENT_NOT_FOUND')
  })
})
