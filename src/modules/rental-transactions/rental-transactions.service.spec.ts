import { ObjectId } from 'mongodb'
import { ForbiddenException } from '@nestjs/common'
import { RentalTransactionsService } from './rental-transactions.service'

describe('RentalTransactionsService', () => {
  let service: RentalTransactionsService
  let eventRepository: { find: jest.Mock }
  let applicationRepository: { findOne: jest.Mock; find: jest.Mock }
  let contractRepository: { findOne: jest.Mock; find: jest.Mock }
  let depositRepository: { find: jest.Mock }
  let outboxRepository: { find: jest.Mock }
  let settlementRepository: { find: jest.Mock }
  let configService: { get: jest.Mock }

  beforeEach(() => {
    eventRepository = { find: jest.fn().mockResolvedValue([]) }
    applicationRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    }
    contractRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    }
    depositRepository = { find: jest.fn().mockResolvedValue([]) }
    outboxRepository = { find: jest.fn().mockResolvedValue([]) }
    settlementRepository = { find: jest.fn().mockResolvedValue([]) }
    configService = { get: jest.fn().mockReturnValue({}) }
    service = new RentalTransactionsService(
      eventRepository as never,
      applicationRepository as never,
      contractRepository as never,
      depositRepository as never,
      outboxRepository as never,
      settlementRepository as never,
      configService as never
    )
  })

  it('projects a legacy application timeline when no append-only events exist', async () => {
    const applicationId = new ObjectId()
    applicationRepository.findOne.mockResolvedValue({
      _id: applicationId,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      submittedAt: new Date('2026-09-10T08:00:00Z'),
      decidedAt: new Date('2026-09-10T09:00:00Z'),
      status: 'accepted',
      reasonCode: null,
      contractId: null,
    })

    const timeline = await service.getTimeline(applicationId.toHexString(), {
      id: 'tenant-1',
      roles: ['tenant'],
    })

    expect(timeline.map(event => event.eventType)).toEqual([
      'application.submitted',
      'application.accepted',
    ])
    expect(eventRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applicationId: applicationId.toHexString() },
      })
    )
  })

  it('rejects a stranger without exposing the application timeline', async () => {
    const applicationId = new ObjectId()
    applicationRepository.findOne.mockResolvedValue({
      _id: applicationId,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
    })

    await expect(
      service.getTimeline(applicationId.toHexString(), {
        id: 'stranger-1',
        roles: ['tenant'],
      })
    ).rejects.toThrow(ForbiddenException)
    expect(eventRepository.find).not.toHaveBeenCalled()
  })

  it('reports terminal ledger and activation stuck reasons with recovery actions', async () => {
    const applicationId = new ObjectId()
    const contractId = new ObjectId()
    applicationRepository.find.mockResolvedValue([
      {
        _id: applicationId,
        provisioningStatus: 'failed',
        contractId: contractId.toHexString(),
        updatedAt: new Date(Date.now() - 3600000),
      },
    ])
    contractRepository.find.mockResolvedValue([
      {
        _id: contractId,
        status: 'active',
        rentalApplicationId: applicationId.toHexString(),
        updatedAt: new Date(Date.now() - 3600000),
        activationFailure: {
          code: 'ACTIVATION_FAILED',
          message: 'gateway',
          at: new Date(Date.now() - 3600000),
          attempts: 5,
        },
      },
    ])
    outboxRepository.find.mockResolvedValue([
      {
        aggregateType: 'contract',
        aggregateId: contractId.toHexString(),
        status: 'failed',
        updatedAt: new Date(Date.now() - 3600000),
      },
    ])

    const stuck = await service.listStuck()
    expect(stuck.map(item => item.reasonCode)).toEqual(
      expect.arrayContaining([
        'PROVISIONING_FAILED',
        'ACTIVATION_FAILED_AFTER_DEPOSIT',
        'LEDGER_FAILED_TERMINAL',
      ])
    )
    expect(
      stuck.find(item => item.reasonCode === 'LEDGER_FAILED_TERMINAL')
        ?.suggestedAction
    ).toBe('RETRY_LEDGER')
  })
})
