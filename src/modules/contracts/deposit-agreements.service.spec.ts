import { ObjectId } from 'mongodb'
import { ConflictException, ForbiddenException } from '@nestjs/common'
import { DepositAgreementsService } from './deposit-agreements.service'
import type { DepositAgreementStatus } from './schemas/deposit-agreement.schema'

describe('DepositAgreementsService', () => {
  const agreementId = new ObjectId().toString()
  type TestAgreement = {
    _id: ObjectId
    agreementCode?: string
    applicationId?: string
    amount?: number
    tenantId: string
    landlordId: string
    status: DepositAgreementStatus
    contentRevision: number
    contentHash: string
    tenantConsent: { consentedAt: Date; contentHash: string } | null
    paymentAttemptId: string | null
    paidAt: Date | null
    depositHash?: string | null
    ledgerStatus?: string | null
    manualConfirmation: {
      confirmedBy: string
      confirmedAt: Date
      note: string
    } | null
    linkedLeaseContractId: string | null
    linkedLeaseContractHash: string | null
  }

  const baseAgreement = (): TestAgreement => ({
    _id: new ObjectId(agreementId),
    agreementCode: 'DPA-app-1',
    applicationId: 'app-1',
    amount: 24_000_000,
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    status: 'draft',
    contentRevision: 1,
    contentHash: 'a'.repeat(64),
    tenantConsent: null,
    paymentAttemptId: null,
    paidAt: null,
    depositHash: null,
    ledgerStatus: null,
    manualConfirmation: null,
    linkedLeaseContractId: null,
    linkedLeaseContractHash: null,
  })

  it('creates one deterministic draft from an application snapshot and reuses it', async () => {
    const repository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ agreementCode: 'DPA-app-1' }),
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const service = new DepositAgreementsService(repository as never)
    const input = {
      applicationId: 'app-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      packageSnapshot: {
        packageId: 'pkg-12',
        version: 2,
        durationMonths: 12 as const,
        monthlyRent: 12_000_000,
        depositPolicy: { type: 'MONTHS_OF_RENT' as const, months: 2 },
        resolvedDepositAmount: 24_000_000,
        currency: 'VND' as const,
      },
    }
    const created = await service.createFromApplicationSnapshot(input)
    const reused = await service.createFromApplicationSnapshot(input)
    expect(created).toEqual(
      expect.objectContaining({
        agreementCode: 'DPA-app-1',
        amount: 24_000_000,
        status: 'draft',
      })
    )
    expect(reused).toEqual({ agreementCode: 'DPA-app-1' })
    expect(repository.save).toHaveBeenCalledTimes(1)
  })

  function createService(
    agreement: TestAgreement = baseAgreement(),
    mockOutbox?: { enqueue: jest.Mock }
  ): {
    service: DepositAgreementsService
    repository: { findOne: jest.Mock; save: jest.Mock }
    agreement: TestAgreement
    outboxService: { enqueue: jest.Mock }
  } {
    const repository = {
      findOne: jest.fn().mockResolvedValue(agreement),
      save: jest.fn(
        (value: unknown): Promise<unknown> => Promise.resolve(value)
      ),
    }
    const outbox = mockOutbox ?? { enqueue: jest.fn().mockResolvedValue({}) }
    return {
      service: new DepositAgreementsService(
        repository as never,
        outbox as never
      ),
      repository,
      agreement,
      outboxService: outbox,
    }
  }

  it('records tenant consent for the current revision and transitions draft to accepted', async () => {
    const { service, repository } = createService()

    const result = await service.consent(
      agreementId,
      'tenant-1',
      1,
      'a'.repeat(64)
    )

    expect(result.status).toBe('accepted')
    expect(result.tenantConsent?.contentHash).toBe('a'.repeat(64))
    expect(repository.save).toHaveBeenCalled()
  })

  it('rejects consent from another tenant or for a stale hash', async () => {
    const context = createService()

    await expect(
      context.service.consent(agreementId, 'tenant-2', 1, 'a'.repeat(64))
    ).rejects.toBeInstanceOf(ForbiddenException)
    await expect(
      context.service.consent(agreementId, 'tenant-1', 2, 'a'.repeat(64))
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('records payment exactly once, computes canonical depositHash, enqueues outbox, and rejects conflict replay', async () => {
    const context = createService({
      ...baseAgreement(),
      status: 'payment-pending',
    })
    const first = await context.service.recordDepositPaid(
      agreementId,
      'attempt-1'
    )
    expect(first.status).toBe('paid')
    expect(first.paymentAttemptId).toBe('attempt-1')
    expect(first.depositHash).toHaveLength(64)
    expect(first.ledgerStatus).toBe('pending')
    expect(context.outboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: 'deposit',
        aggregateId: agreementId,
        eventType: 'deposit.paid',
        action: 'recordDeposit',
      })
    )

    context.agreement.status = 'paid'
    context.agreement.paymentAttemptId = 'attempt-1'
    const replay = await context.service.recordDepositPaid(
      agreementId,
      'attempt-1'
    )
    expect(replay.status).toBe('paid')
    await expect(
      context.service.recordDepositPaid(agreementId, 'attempt-2')
    ).rejects.toThrow('DEPOSIT_PAYMENT_CONFLICT')
  })

  it('allows staff manual confirmation, computes canonical depositHash, enqueues outbox, and does not overwrite a paid agreement', async () => {
    const context = createService({ ...baseAgreement(), status: 'accepted' })
    const confirmed = await context.service.confirmDepositReceived(
      agreementId,
      'staff-1',
      'cash receipt #1'
    )
    expect(confirmed.status).toBe('paid')
    expect(confirmed.depositHash).toHaveLength(64)
    expect(confirmed.ledgerStatus).toBe('pending')
    expect(confirmed.manualConfirmation?.confirmedBy).toBe('staff-1')
    expect(context.outboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: 'deposit',
        aggregateId: agreementId,
        action: 'recordDeposit',
      })
    )

    context.agreement.status = 'paid'
    const replay = await context.service.confirmDepositReceived(
      agreementId,
      'staff-1',
      'ignored'
    )
    expect(replay.status).toBe('paid')
  })

  it('links the paid agreement to one lease idempotently', async () => {
    const context = createService({ ...baseAgreement(), status: 'paid' })
    const linked = await context.service.linkToLease(
      agreementId,
      'contract-1',
      'hash-1'
    )
    expect(linked.status).toBe('applied-to-lease-security')

    context.agreement.status = 'applied-to-lease-security'
    context.agreement.linkedLeaseContractId = 'contract-1'
    context.agreement.linkedLeaseContractHash = 'hash-1'
    await expect(
      context.service.linkToLease(agreementId, 'contract-1', 'hash-1')
    ).resolves.toBe(context.agreement)
    await expect(
      context.service.linkToLease(agreementId, 'contract-2', 'hash-2')
    ).rejects.toThrow('DEPOSIT_LEASE_LINK_CONFLICT')
  })
})
