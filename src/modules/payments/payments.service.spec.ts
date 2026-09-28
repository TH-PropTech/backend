import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { Contract } from '../contracts/schemas/contract.schema'
import { Payment } from './schemas/payment.schema'
import { PaymentsService } from './payments.service'
import type { NotificationsService } from '../notifications/notifications.service'
import type { LedgerOutboxService } from '../fabric/ledger-outbox.service'

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
        args: [
          payment._id.toHexString(),
          'contract-1',
          '10000000',
          expect.stringMatching(/^[a-f0-9]{64}$/),
        ],
      })
    )
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
})
