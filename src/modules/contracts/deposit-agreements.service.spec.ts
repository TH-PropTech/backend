import { ObjectId } from 'mongodb'
import { ConflictException, ForbiddenException } from '@nestjs/common'
import { DepositAgreementsService } from './deposit-agreements.service'
import type { DepositAgreementStatus } from './schemas/deposit-agreement.schema'

describe('DepositAgreementsService', () => {
  const agreementId = new ObjectId().toString()
  type TestAgreement = {
    _id: ObjectId
    tenantId: string
    landlordId: string
    status: DepositAgreementStatus
    contentRevision: number
    contentHash: string
    tenantConsent: { consentedAt: Date; contentHash: string } | null
    paymentAttemptId: string | null
    paidAt: Date | null
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
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    status: 'draft',
    contentRevision: 1,
    contentHash: 'a'.repeat(64),
    tenantConsent: null,
    paymentAttemptId: null,
    paidAt: null,
    manualConfirmation: null,
    linkedLeaseContractId: null,
    linkedLeaseContractHash: null,
  })

  function createService(agreement: TestAgreement = baseAgreement()): {
    service: DepositAgreementsService
    repository: { findOne: jest.Mock; save: jest.Mock }
    agreement: TestAgreement
  } {
    const repository = {
      findOne: jest.fn().mockResolvedValue(agreement),
      save: jest.fn(
        (value: unknown): Promise<unknown> => Promise.resolve(value)
      ),
    }
    return {
      service: new DepositAgreementsService(repository as never),
      repository,
      agreement,
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

  it('records payment exactly once and rejects a different replay attempt', async () => {
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

  it('allows staff manual confirmation but does not overwrite a paid agreement', async () => {
    const context = createService({ ...baseAgreement(), status: 'accepted' })
    const confirmed = await context.service.confirmDepositReceived(
      agreementId,
      'staff-1',
      'cash receipt #1'
    )
    expect(confirmed.status).toBe('paid')
    expect(confirmed.manualConfirmation?.confirmedBy).toBe('staff-1')

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
