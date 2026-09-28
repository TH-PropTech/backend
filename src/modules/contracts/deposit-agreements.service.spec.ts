import { ObjectId } from 'mongodb'
import { ConflictException, ForbiddenException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { DepositAgreementsService } from './deposit-agreements.service'
import type { DepositAgreementStatus } from './schemas/deposit-agreement.schema'

describe('DepositAgreementsService', () => {
  const agreementId = new ObjectId().toString()
  type TestAgreement = {
    _id: ObjectId
    agreementCode?: string
    applicationId?: string
    propertyId?: string | null
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
    expect(created.templateVersion).toBe('deposit-v1')
    expect(created.contentHash).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            agreementCode: 'DPA-app-1',
            applicationId: 'app-1',
            packageSnapshot: input.packageSnapshot,
            purpose: 'SECURE_CONCLUSION_THEN_PERFORMANCE',
            templateVersion: 'deposit-v1',
          })
        )
        .digest('hex')
    )
  })

  it('revises the security deposit snapshot and hash before consent', async () => {
    const agreement = {
      ...baseAgreement(),
      purpose: 'SECURE_CONCLUSION_THEN_PERFORMANCE',
      templateVersion: 'deposit-v1',
      packageSnapshot: {
        packageId: 'pkg-12',
        version: 1,
        durationMonths: 12,
        monthlyRent: 12_000_000,
        depositPolicy: { type: 'FIXED_AMOUNT', amount: 24_000_000 },
        resolvedDepositAmount: 24_000_000,
      },
    }
    const repository = {
      findOne: jest.fn().mockResolvedValue(agreement),
      save: jest.fn().mockImplementation(value => Promise.resolve(value)),
    }
    const service = new DepositAgreementsService(repository as never)
    const originalHash = agreement.contentHash

    await service.reviseSecurityDepositBeforeConsent(
      agreement._id.toHexString(),
      30_000_000
    )

    expect(agreement.amount).toBe(30_000_000)
    expect(agreement.contentRevision).toBe(2)
    expect(agreement.packageSnapshot.resolvedDepositAmount).toBe(30_000_000)
    expect(agreement.contentHash).not.toBe(originalHash)
    expect(repository.save).toHaveBeenCalledWith(agreement)
  })

  it('rejects a security deposit revision after consent', async () => {
    const agreement = {
      ...baseAgreement(),
      status: 'accepted' as const,
      tenantConsent: { consentedAt: new Date(), contentHash: 'a'.repeat(64) },
      packageSnapshot: { resolvedDepositAmount: 24_000_000 },
    }
    const service = new DepositAgreementsService({
      findOne: jest.fn().mockResolvedValue(agreement),
      save: jest.fn(),
    } as never)

    await expect(
      service.reviseSecurityDepositBeforeConsent(
        agreement._id.toHexString(),
        30_000_000
      )
    ).rejects.toThrow('COMMERCIAL_DEPOSIT_LOCKED')
  })

  it('creates a deposit-v2 holding agreement for the resolved reservation deposit', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const service = new DepositAgreementsService(repository as never)

    const agreement = await service.createFromApplicationSnapshot({
      applicationId: 'app-holding',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      packageSnapshot: {
        packageId: 'pkg-12',
        version: 2,
        durationMonths: 12,
        monthlyRent: 10_000_000,
        depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
        resolvedDepositAmount: 20_000_000,
        settlementPolicy: {
          holdingDeposit: { type: 'PERCENT_OF_SECURITY', percent: 30 },
          allowedPaymentCycles: [1, 3, 6],
          defaultPaymentCycle: 3,
          firstPaymentDueOffsetDays: 3,
        },
        resolvedHoldingDepositAmount: 6_000_000,
        resolvedSecurityTopUpAmount: 14_000_000,
      },
    })

    expect(agreement).toMatchObject({
      amount: 6_000_000,
      depositKind: 'HOLDING',
      securityDepositTotal: 20_000_000,
      securityTopUpAmount: 14_000_000,
      templateVersion: 'deposit-v2',
    })
  })

  it('creates and links one draft deposit agreement for a contract', async () => {
    const contractId = new ObjectId()
    const contract = {
      _id: contractId,
      contractCode: 'HD-1',
      propertyId: 'property-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      rentalApplicationId: 'application-1',
      depositAgreementId: null,
      monthlyRent: 10_000_000,
      deposit: 20_000_000,
      durationMonths: 12,
      executionPolicySnapshot: null,
      packageSnapshot: null,
    }
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: unknown) => ({
        ...(value as object),
        _id: new ObjectId(),
      })),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      update: jest.fn(),
    }
    const service = new DepositAgreementsService(
      repository as never,
      undefined,
      undefined,
      undefined,
      undefined,
      contractRepository as never
    )

    const created = await service.createForContract(contractId.toHexString())

    expect(created.status).toBe('draft')
    expect(contract.depositAgreementId).toBe(created._id.toHexString())
    expect(contractRepository.save).toHaveBeenCalledWith(contract)
    await expect(
      service.createForContract(contractId.toHexString())
    ).rejects.toThrow('DEPOSIT_AGREEMENT_ALREADY_EXISTS')
  })

  function createService(
    agreement: TestAgreement = baseAgreement(),
    mockOutbox?: { enqueue: jest.Mock },
    mockApartmentRepository?: { findOne: jest.Mock; save: jest.Mock },
    mockContractRepository?: { update: jest.Mock },
    mockContractsService?: {
      activatePendingForDepositAgreement: jest.Mock
    }
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
        outbox as never,
        mockApartmentRepository as never,
        mockContractsService as never,
        undefined,
        mockContractRepository as never
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

  it('treats a repeated accepted consent as idempotent and preserves consentedAt', async () => {
    const consentedAt = new Date('2026-01-01T00:00:00.000Z')
    const context = createService({
      ...baseAgreement(),
      status: 'accepted',
      tenantConsent: { consentedAt, contentHash: 'a'.repeat(64) },
    })

    const result = await context.service.consent(
      agreementId,
      'tenant-1',
      1,
      'a'.repeat(64)
    )

    expect(result.tenantConsent?.consentedAt).toBe(consentedAt)
    expect(context.repository.save).not.toHaveBeenCalled()
  })

  it('asks the flow notifier to check stages after consent, bank payment and staff confirmation', async () => {
    const notifier = { notifyForDepositAgreement: jest.fn() }
    const createNotifyingService = (
      agreement: TestAgreement
    ): DepositAgreementsService =>
      new DepositAgreementsService(
        {
          findOne: jest.fn().mockResolvedValue(agreement),
          save: jest.fn((value: unknown) => Promise.resolve(value)),
        } as never,
        { enqueue: jest.fn().mockResolvedValue({}) } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        notifier as never
      )

    await createNotifyingService(baseAgreement()).consent(
      agreementId,
      'tenant-1',
      1,
      'a'.repeat(64)
    )
    await createNotifyingService({
      ...baseAgreement(),
      status: 'payment-pending',
    }).recordDepositPaid(agreementId, 'attempt-1')
    await createNotifyingService({
      ...baseAgreement(),
      status: 'accepted',
    }).confirmDepositReceived(agreementId, 'staff-1', 'Đã nhận chuyển khoản')

    expect(notifier.notifyForDepositAgreement).toHaveBeenCalledTimes(3)
    expect(notifier.notifyForDepositAgreement).toHaveBeenCalledWith(agreementId)
  })

  it('marks an accepted agreement payment-pending', async () => {
    const context = createService({
      ...baseAgreement(),
      status: 'accepted',
      tenantConsent: { consentedAt: new Date(), contentHash: 'a'.repeat(64) },
    })

    const result = await context.service.markPaymentPending(
      agreementId,
      'tenant-1'
    )

    expect(result.status).toBe('payment-pending')
    expect(context.repository.save).toHaveBeenCalledTimes(1)
  })

  it('keeps a payment-pending agreement unchanged when a new attempt replaces an expired one', async () => {
    const context = createService({
      ...baseAgreement(),
      status: 'payment-pending',
      tenantConsent: { consentedAt: new Date(), contentHash: 'a'.repeat(64) },
    })

    const result = await context.service.markPaymentPending(
      agreementId,
      'tenant-1'
    )

    expect(result.status).toBe('payment-pending')
    expect(context.repository.save).not.toHaveBeenCalled()
  })

  it('rejects marking payment-pending without consent or for a paid agreement', async () => {
    await expect(
      createService().service.markPaymentPending(agreementId, 'tenant-1')
    ).rejects.toThrow('DEPOSIT_CONSENT_REQUIRED')
    await expect(
      createService({
        ...baseAgreement(),
        status: 'paid',
        tenantConsent: {
          consentedAt: new Date(),
          contentHash: 'a'.repeat(64),
        },
      }).service.markPaymentPending(agreementId, 'tenant-1')
    ).rejects.toThrow('DEPOSIT_CONSENT_REQUIRED')
  })

  it('rejects marking payment-pending for another tenant', async () => {
    await expect(
      createService().service.markPaymentPending(agreementId, 'tenant-2')
    ).rejects.toBeInstanceOf(ForbiddenException)
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

  it('records depositPaidAt on the linked contract only when it is still null', async () => {
    const contractRepository = { update: jest.fn().mockResolvedValue({}) }
    const context = createService(
      { ...baseAgreement(), status: 'payment-pending' },
      undefined,
      undefined,
      contractRepository
    )

    await context.service.recordDepositPaid(agreementId, 'attempt-1')

    expect(contractRepository.update).toHaveBeenCalledWith(
      {
        depositAgreementId: agreementId,
        depositPaidAt: expect.any(Object) as unknown,
      },
      expect.objectContaining({
        depositPaidAt: expect.any(Date) as unknown,
      }) as unknown
    )
  })

  it('projects a paid deposit onto the matching apartment reservation', async () => {
    const propertyId = new ObjectId().toHexString()
    const apartment = {
      _id: new ObjectId(propertyId),
      rentalReservation: {
        applicationId: 'app-1',
        reservedAt: new Date(),
        mode: 'application-accepted',
      },
    }
    const apartmentRepository = {
      findOne: jest.fn().mockResolvedValue(apartment),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const context = createService(
      {
        ...baseAgreement(),
        propertyId,
        status: 'payment-pending',
      },
      undefined,
      apartmentRepository
    )

    await context.service.recordDepositPaid(agreementId, 'attempt-1')

    expect(apartment.rentalReservation).toEqual(
      expect.objectContaining({
        applicationId: 'app-1',
        mode: 'deposit-paid',
        depositAgreementId: agreementId,
      })
    )
    expect(apartmentRepository.save).toHaveBeenCalledWith(apartment)
  })

  it.each([['cancelled', 'cancel'] as const, ['expired', 'expire'] as const])(
    'releases only the matching reservation when a deposit is %s',
    async (status, action) => {
      const propertyId = new ObjectId().toHexString()
      const apartment = {
        _id: new ObjectId(propertyId),
        rentalReservation: {
          applicationId: 'app-1',
          reservedAt: new Date(),
          mode: 'application-accepted' as const,
          revision: 4,
        },
      }
      const apartmentRepository = {
        findOne: jest.fn().mockResolvedValue(apartment),
        save: jest.fn((value: unknown) => Promise.resolve(value)),
      }
      const context = createService(
        {
          ...baseAgreement(),
          propertyId,
          status: 'payment-pending',
        },
        undefined,
        apartmentRepository
      )

      const result =
        action === 'cancel'
          ? await context.service.cancel(agreementId, 'tenant-1')
          : await context.service.expire(agreementId)

      expect(result.status).toBe(status)
      expect(apartment.rentalReservation).toBeNull()
      expect(apartmentRepository.save).toHaveBeenCalledWith(apartment)
    }
  )

  it('does not release a reservation or close a paid deposit', async () => {
    const propertyId = new ObjectId().toHexString()
    const apartmentRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    }
    const context = createService(
      { ...baseAgreement(), propertyId, status: 'paid' },
      undefined,
      apartmentRepository
    )

    await expect(
      context.service.cancel(agreementId, 'tenant-1')
    ).rejects.toThrow('DEPOSIT_CANCELLATION_NOT_ALLOWED')
    expect(apartmentRepository.findOne).not.toHaveBeenCalled()
  })

  it.each([
    [
      'an active lease',
      {
        applicationId: 'app-1',
        reservedAt: new Date(),
        mode: 'deposit-paid',
        depositAgreementId: agreementId,
        contractId: 'contract-1',
      },
    ],
    [
      'a different deposit agreement',
      {
        applicationId: 'app-1',
        reservedAt: new Date(),
        mode: 'deposit-paid',
        depositAgreementId: 'other-deposit',
      },
    ],
  ])(
    'does not overwrite the reservation for %s',
    async (_case, reservation) => {
      const propertyId = new ObjectId().toHexString()
      const apartment = {
        _id: new ObjectId(propertyId),
        rentalReservation: reservation,
      }
      const apartmentRepository = {
        findOne: jest.fn().mockResolvedValue(apartment),
        save: jest.fn((value: unknown) => Promise.resolve(value)),
      }
      const context = createService(
        {
          ...baseAgreement(),
          propertyId,
          status: 'payment-pending',
        },
        undefined,
        apartmentRepository
      )

      await context.service.recordDepositPaid(agreementId, 'attempt-1')

      expect(apartment.rentalReservation).toBe(reservation)
      expect(apartmentRepository.save.mock.calls).toHaveLength(0)
    }
  )

  it('allows staff manual confirmation, computes canonical depositHash, enqueues outbox, and does not overwrite a paid agreement', async () => {
    const contractRepository = { update: jest.fn().mockResolvedValue({}) }
    const context = createService(
      { ...baseAgreement(), status: 'accepted' },
      undefined,
      undefined,
      contractRepository
    )
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
    expect(contractRepository.update).toHaveBeenCalledWith(
      {
        depositAgreementId: agreementId,
        depositPaidAt: expect.any(Object) as unknown,
      },
      expect.objectContaining({
        depositPaidAt: expect.any(Date) as unknown,
      }) as unknown
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

  it('keeps payment callbacks successful and records activation failures', async () => {
    const contractRepository = { update: jest.fn().mockResolvedValue({}) }
    const contractsService = {
      activatePendingForDepositAgreement: jest
        .fn()
        .mockRejectedValue(new ConflictException('ACTIVATION_FAILED')),
    }
    const context = createService(
      { ...baseAgreement(), status: 'payment-pending' },
      undefined,
      undefined,
      contractRepository,
      contractsService
    )

    await expect(
      context.service.recordDepositPaid(
        agreementId,
        'attempt-activation-failure'
      )
    ).resolves.toEqual(expect.objectContaining({ status: 'paid' }))

    expect(
      contractsService.activatePendingForDepositAgreement
    ).toHaveBeenCalledWith(agreementId)
    expect(contractRepository.update).toHaveBeenCalledWith(
      { depositAgreementId: agreementId },
      {
        activationFailure: expect.objectContaining({
          code: 'ACTIVATION_FAILED',
          message: 'ACTIVATION_FAILED',
          attempts: 1,
          at: expect.any(Date) as unknown,
        }) as unknown,
      }
    )
  })
})
