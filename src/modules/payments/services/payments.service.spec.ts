import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { Contract } from '../../contracts/schemas/contract.schema'
import { Payment } from '../schemas/payment.schema'
import { PaymentsService } from './payments.service'
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
})
