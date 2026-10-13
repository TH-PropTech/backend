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
    depositRepository.find.mockResolvedValue([
      {
        applicationId: applicationId.toHexString(),
        linkedLeaseContractId: contractId.toHexString(),
        status: 'payment-pending',
        updatedAt: new Date(Date.now() - 3600000),
      },
      {
        applicationId: applicationId.toHexString(),
        linkedLeaseContractId: contractId.toHexString(),
        status: 'accepted',
        createdAt: new Date(Date.now() - 48 * 3600000),
        updatedAt: new Date(Date.now() - 48 * 3600000),
      },
    ])
    contractRepository.find.mockResolvedValue([
      {
        _id: contractId,
        status: 'fully-signed-pending-deposit',
        rentalApplicationId: applicationId.toHexString(),
        updatedAt: new Date(Date.now() - 48 * 3600000),
      },
      {
        _id: new ObjectId(),
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
    settlementRepository.find.mockResolvedValue([
      {
        contractId: contractId.toHexString(),
        status: 'overdue',
        dueAt: new Date(Date.now() - 48 * 3600000),
        handover: null,
      },
    ])

    const stuck = await service.listStuck()
    expect(stuck.map(item => item.reasonCode)).toEqual(
      expect.arrayContaining([
        'PROVISIONING_FAILED',
        'DEPOSIT_ATTEMPT_EXPIRED',
        'DEPOSIT_UNPAID_TOO_LONG',
        'SIGNED_PENDING_DEPOSIT_TOO_LONG',
        'ACTIVATION_FAILED_AFTER_DEPOSIT',
        'LEDGER_FAILED_TERMINAL',
        'SETTLEMENT_OVERDUE',
        'HANDOVER_OVERDUE',
      ])
    )
    expect(
      stuck.find(item => item.reasonCode === 'LEDGER_FAILED_TERMINAL')
        ?.suggestedAction
    ).toBe('RETRY_LEDGER')
  })

  it('rejects activation recovery before both signatures are present, surfacing the real activation gate reason', async () => {
    const contractId = new ObjectId()
    contractRepository.findOne.mockResolvedValue({
      _id: contractId,
      status: 'fully-signed-pending-deposit',
      signedByTenant: true,
      signedByLandlord: false,
      tenantId: 'tenant-1',
      rentalApplicationId: null,
    })
    // retryActivation() is the real business-rule check (ContractsService);
    // the recovery action MUST delegate to it rather than re-implementing
    // the check, so it throws the activation gate's own reason code.
    const retryActivation = jest
      .fn()
      .mockRejectedValue(new Error('ACTIVATION_NOT_READY'))
    const moduleRef = { get: jest.fn().mockReturnValue({ retryActivation }) }
    service = new RentalTransactionsService(
      eventRepository as never,
      applicationRepository as never,
      contractRepository as never,
      depositRepository as never,
      outboxRepository as never,
      settlementRepository as never,
      configService as never,
      moduleRef as never
    )

    await expect(
      service.recover(
        contractId.toHexString(),
        { id: 'staff-1', role: 'staff' },
        { action: 'RETRY_ACTIVATION', reason: 'retry after provider outage' }
      )
    ).rejects.toThrow('ACTIVATION_NOT_READY')
    expect(retryActivation).toHaveBeenCalledWith(contractId.toHexString())
  })

  it('calls the real activation gate and records an auditable recovery', async () => {
    const contractId = new ObjectId()
    contractRepository.findOne.mockResolvedValue({
      _id: contractId,
      status: 'fully-signed-pending-deposit',
      signedByTenant: true,
      signedByLandlord: true,
      tenantId: 'tenant-1',
      rentalApplicationId: 'application-1',
    })
    const retryActivation = jest.fn().mockResolvedValue({ status: 'active' })
    const moduleRef = { get: jest.fn().mockReturnValue({ retryActivation }) }
    const audit = { record: jest.fn().mockResolvedValue({}) }
    service = new RentalTransactionsService(
      eventRepository as never,
      applicationRepository as never,
      contractRepository as never,
      depositRepository as never,
      outboxRepository as never,
      settlementRepository as never,
      configService as never,
      moduleRef as never,
      audit as never
    )

    await expect(
      service.recover(
        contractId.toHexString(),
        { id: 'staff-1', role: 'staff' },
        { action: 'RETRY_ACTIVATION', reason: 'retry after provider outage' }
      )
    ).resolves.toMatchObject({ action: 'RETRY_ACTIVATION', status: 'active' })
    expect(retryActivation).toHaveBeenCalledWith(contractId.toHexString())
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: contractId.toHexString(),
        actorRole: 'staff',
        reasonCode: 'RETRY_ACTIVATION',
      })
    )
  })

  it('reissues a deposit payment request through the existing payment service', async () => {
    const contractId = new ObjectId()
    contractRepository.findOne.mockResolvedValue({
      _id: contractId,
      status: 'fully-signed-pending-deposit',
      depositAgreementId: 'deposit-1',
      tenantId: 'tenant-1',
      rentalApplicationId: 'application-1',
    })
    const initDepositPayment = jest.fn().mockResolvedValue({})
    const moduleRef = {
      get: jest.fn().mockReturnValue({ initDepositPayment }),
    }
    service = new RentalTransactionsService(
      eventRepository as never,
      applicationRepository as never,
      contractRepository as never,
      depositRepository as never,
      outboxRepository as never,
      settlementRepository as never,
      configService as never,
      moduleRef as never
    )

    await expect(
      service.recover(
        contractId.toHexString(),
        { id: 'staff-1', role: 'staff' },
        { action: 'REISSUE_DEPOSIT_REQUEST', reason: 'attempt expired' }
      )
    ).resolves.toMatchObject({
      action: 'REISSUE_DEPOSIT_REQUEST',
      status: 'payment-pending',
    })
    expect(initDepositPayment).toHaveBeenCalledWith('deposit-1', 'tenant-1')
  })

  it('rejects REISSUE_DEPOSIT_REQUEST when the contract has no deposit agreement', async () => {
    const contractId = new ObjectId()
    contractRepository.findOne.mockResolvedValue({
      _id: contractId,
      status: 'draft',
      depositAgreementId: null,
      tenantId: 'tenant-1',
      rentalApplicationId: null,
    })

    await expect(
      service.recover(
        contractId.toHexString(),
        { id: 'staff-1', role: 'staff' },
        { action: 'REISSUE_DEPOSIT_REQUEST', reason: 'attempt expired' }
      )
    ).rejects.toThrow('DEPOSIT_AGREEMENT_NOT_FOUND')
  })

  it('expires a deposit agreement through the existing deposit service', async () => {
    const contractId = new ObjectId()
    contractRepository.findOne.mockResolvedValue({
      _id: contractId,
      status: 'draft',
      depositAgreementId: 'deposit-1',
      rentalApplicationId: 'application-1',
    })
    const expire = jest.fn().mockResolvedValue({ status: 'expired' })
    const moduleRef = { get: jest.fn().mockReturnValue({ expire }) }
    service = new RentalTransactionsService(
      eventRepository as never,
      applicationRepository as never,
      contractRepository as never,
      depositRepository as never,
      outboxRepository as never,
      settlementRepository as never,
      configService as never,
      moduleRef as never
    )

    await expect(
      service.recover(
        contractId.toHexString(),
        { id: 'staff-1', role: 'staff' },
        { action: 'EXPIRE_DEPOSIT', reason: 'tenant unresponsive' }
      )
    ).resolves.toMatchObject({ action: 'EXPIRE_DEPOSIT', status: 'expired' })
    expect(expire).toHaveBeenCalledWith('deposit-1')
  })

  it('rejects EXPIRE_DEPOSIT when the contract has no deposit agreement', async () => {
    const contractId = new ObjectId()
    contractRepository.findOne.mockResolvedValue({
      _id: contractId,
      status: 'draft',
      depositAgreementId: null,
      rentalApplicationId: null,
    })

    await expect(
      service.recover(
        contractId.toHexString(),
        { id: 'staff-1', role: 'staff' },
        { action: 'EXPIRE_DEPOSIT', reason: 'tenant unresponsive' }
      )
    ).rejects.toThrow('DEPOSIT_AGREEMENT_NOT_FOUND')
  })

  it('retries provisioning through the existing rental applications service', async () => {
    const contractId = new ObjectId()
    contractRepository.findOne.mockResolvedValue({
      _id: contractId,
      status: 'draft',
      rentalApplicationId: 'application-1',
    })
    const retryProvisioning = jest
      .fn()
      .mockResolvedValue({ provisioningStatus: 'ready' })
    const moduleRef = {
      get: jest.fn().mockReturnValue({ retryProvisioning }),
    }
    service = new RentalTransactionsService(
      eventRepository as never,
      applicationRepository as never,
      contractRepository as never,
      depositRepository as never,
      outboxRepository as never,
      settlementRepository as never,
      configService as never,
      moduleRef as never
    )

    await expect(
      service.recover(
        contractId.toHexString(),
        { id: 'staff-1', role: 'staff' },
        { action: 'RETRY_PROVISIONING', reason: 'provider timed out' }
      )
    ).resolves.toMatchObject({
      action: 'RETRY_PROVISIONING',
      status: 'ready',
    })
    expect(retryProvisioning).toHaveBeenCalledWith('application-1', 'staff-1')
  })

  it('rejects RETRY_PROVISIONING when the contract has no linked rental application', async () => {
    const contractId = new ObjectId()
    contractRepository.findOne.mockResolvedValue({
      _id: contractId,
      status: 'draft',
      rentalApplicationId: null,
    })

    await expect(
      service.recover(
        contractId.toHexString(),
        { id: 'staff-1', role: 'staff' },
        { action: 'RETRY_PROVISIONING', reason: 'provider timed out' }
      )
    ).rejects.toThrow('RENTAL_APPLICATION_NOT_FOUND')
  })

  it('retries an allowlisted failed ledger event through the existing outbox service', async () => {
    const contractId = new ObjectId()
    contractRepository.findOne.mockResolvedValue({
      _id: contractId,
      status: 'active',
      rentalApplicationId: 'application-1',
    })
    outboxRepository.find.mockResolvedValue([
      { _id: new ObjectId(), status: 'failed' },
    ])
    const retryTerminal = jest.fn().mockResolvedValue({ status: 'pending' })
    const moduleRef = { get: jest.fn().mockReturnValue({ retryTerminal }) }
    service = new RentalTransactionsService(
      eventRepository as never,
      applicationRepository as never,
      contractRepository as never,
      depositRepository as never,
      outboxRepository as never,
      settlementRepository as never,
      configService as never,
      moduleRef as never
    )

    await expect(
      service.recover(
        contractId.toHexString(),
        { id: 'staff-1', role: 'staff' },
        { action: 'RETRY_LEDGER', reason: 'fabric peer recovered' }
      )
    ).resolves.toMatchObject({ action: 'RETRY_LEDGER', status: 'pending' })
    expect(retryTerminal).toHaveBeenCalledWith(expect.any(String), 'staff')
  })

  it('rejects RETRY_LEDGER when there is no failed ledger event for the contract', async () => {
    const contractId = new ObjectId()
    contractRepository.findOne.mockResolvedValue({
      _id: contractId,
      status: 'active',
      rentalApplicationId: 'application-1',
    })
    outboxRepository.find.mockResolvedValue([])
    const moduleRef = {
      get: jest.fn().mockReturnValue({ retryTerminal: jest.fn() }),
    }
    service = new RentalTransactionsService(
      eventRepository as never,
      applicationRepository as never,
      contractRepository as never,
      depositRepository as never,
      outboxRepository as never,
      settlementRepository as never,
      configService as never,
      moduleRef as never
    )

    await expect(
      service.recover(
        contractId.toHexString(),
        { id: 'staff-1', role: 'staff' },
        { action: 'RETRY_LEDGER', reason: 'fabric peer recovered' }
      )
    ).rejects.toThrow('LEDGER_EVENT_NOT_FOUND')
  })
})
