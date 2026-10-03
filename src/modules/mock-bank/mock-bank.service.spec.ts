import { BadRequestException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { ConflictException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { MockBankService } from './mock-bank.service'
import { RentalTransactionEventService } from '../rental-transactions/rental-transaction-event.service'
import type { RentalTransactionEvent } from '../rental-transactions/schemas/rental-transaction-event.schema'

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

describe('MockBankService', () => {
  const paymentId = new ObjectId().toString()
  const tenantId = 'tenant-1'

  type TestAttempt = {
    _id: ObjectId
    provider: 'mock-bank'
    txRef: string
    paymentId: string
    paymentType: 'deposit' | 'rent' | 'settlement' | 'invoice'
    paymentIds?: string[] | null
    userId: string
    amount: number
    status: 'pending' | 'succeeded'
    expiresAt: Date
    processedAt: Date | null
    callbackDigest: string | null
  }

  type TestPayment = {
    _id: ObjectId
    contractId: string
    tenantId: string
    amount: number
    description: string
    status: 'unpaid' | 'paid'
    txRef: string | null
    paidAt: Date | null
    ledgerStatus: 'not-required' | 'pending'
    type?: 'rent' | 'platform-fee'
    payerId?: string | null
    payerRole?: 'tenant' | 'landlord' | null
    payeeRole?: 'landlord' | 'platform' | null
    amountBeforeVat?: number | null
    vatAmount?: number | null
    invoiceCode?: string | null
    receiptCode?: string | null
    receiptHash?: string | null
    dueDate?: Date
  }

  function createContext(): {
    service: MockBankService
    attempt: TestAttempt
    payment: TestPayment
    attemptRepository: {
      findOne: jest.Mock
      create: jest.Mock
      save: jest.Mock
      update: jest.Mock
    }
    paymentRepository: { findOne: jest.Mock; save: jest.Mock }
    settlementRepository: { findOne: jest.Mock; save: jest.Mock }
    contractRepository: { findOne: jest.Mock }
    walletRepository: {
      findOne: jest.Mock
      create: jest.Mock
      save: jest.Mock
      manager: { findOneAndUpdate: jest.Mock }
    }
    providerRegistry: {
      isEnabled: jest.Mock
      get: jest.Mock
      getAccountLink: jest.Mock
      createPaymentIntent: jest.Mock
    }
    configService: { get: jest.Mock }
    ledgerOutboxService: { enqueue: jest.Mock }
    depositAgreementsService: {
      getAgreement: jest.Mock
      markPaymentPending: jest.Mock
      recordDepositPaid: jest.Mock
    }
  } {
    const attempt = {
      _id: new ObjectId(),
      provider: 'mock-bank' as const,
      txRef: 'MOCK-RENT-1',
      paymentId,
      paymentType: 'rent' as const,
      userId: tenantId,
      amount: 2_000_000,
      status: 'pending' as 'pending' | 'succeeded',
      expiresAt: new Date(Date.now() + 60_000),
      processedAt: null,
      callbackDigest: null,
    }
    const payment = {
      _id: new ObjectId(paymentId),
      contractId: 'contract-1',
      tenantId,
      amount: 2_000_000,
      description: 'Rent 2026-09',
      status: 'unpaid' as 'unpaid' | 'paid',
      txRef: null,
      paidAt: null,
      ledgerStatus: 'not-required' as const,
    }
    const attemptRepository = {
      findOne: jest.fn().mockResolvedValue(attempt),
      create: jest.fn((input: object): unknown => ({
        _id: new ObjectId(),
        ...input,
      })),
      save: jest.fn(
        (input: unknown): Promise<unknown> => Promise.resolve(input)
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    }
    const paymentRepository = {
      findOne: jest.fn().mockResolvedValue(payment),
      save: jest.fn(
        (input: unknown): Promise<unknown> => Promise.resolve(input)
      ),
    }
    const settlementRepository = {
      findOne: jest.fn(),
      save: jest.fn(
        (input: unknown): Promise<unknown> => Promise.resolve(input)
      ),
    }
    const contractRepository = { findOne: jest.fn().mockResolvedValue(null) }
    const depositAgreementsService = {
      getAgreement: jest.fn(),
      markPaymentPending: jest.fn(),
      recordDepositPaid: jest.fn(),
    }
    const walletRepository = {
      findOne: jest.fn().mockResolvedValue({
        userId: tenantId,
        provider: 'mock-bank',
        externalAccountRef: 'mock-account:tenant-1',
        status: 'linked',
        simulation: true,
      }),
      create: jest.fn((input: unknown): unknown => input),
      save: jest.fn(
        (input: unknown): Promise<unknown> => Promise.resolve(input)
      ),
      manager: {
        findOneAndUpdate: jest.fn(),
      },
    }
    const configService = {
      get: jest.fn((key: string) =>
        key === 'rentalFlow.mockBankSecret'
          ? 'secret-for-tests-012345678901234567'
          : key === 'rentalFlow.paymentProvider'
            ? 'mock-bank'
            : 'test'
      ),
    }
    const mockAdapter = {
      name: 'mock-bank' as const,
      newTxRef: jest.fn().mockReturnValue('MOCK-1'),
      createPaymentIntent: jest.fn().mockResolvedValue({
        provider: 'mock-bank',
        txRef: 'MOCK-1',
        redirectUrl: 'mockbank://pay?txRef=MOCK-1&amount=2000000',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    }
    const providerRegistry = {
      isEnabled: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue(mockAdapter),
      getAccountLink: jest.fn().mockResolvedValue({
        provider: 'mock-bank',
        externalAccountRef: `mock-account:${tenantId}`,
        status: 'linked',
        simulation: true,
      }),
      createPaymentIntent: mockAdapter.createPaymentIntent,
    }
    const ledgerOutboxService = { enqueue: jest.fn().mockResolvedValue({}) }
    const service = new MockBankService(
      depositAgreementsService as never,
      paymentRepository as never,
      attemptRepository as never,
      walletRepository as never,
      providerRegistry as never,
      configService as never,
      ledgerOutboxService as never,
      settlementRepository as never,
      contractRepository as never
    )
    return {
      service,
      attempt,
      payment,
      attemptRepository,
      paymentRepository,
      settlementRepository,
      contractRepository,
      walletRepository,
      providerRegistry,
      configService,
      ledgerOutboxService,
      depositAgreementsService,
    }
  }

  it('creates a rent payment attempt from server-side invoice data', async () => {
    const { service, attemptRepository } = createContext()
    attemptRepository.findOne.mockResolvedValueOnce(null)

    const result = await service.initRentPayment(paymentId, tenantId)

    expect(result.amount).toBe(2_000_000)
    expect(result.deepLink).toContain('MOCK-1')
    expect(attemptRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ paymentType: 'rent', amount: 2_000_000 })
    )
  })

  it('allows only the configured payer to initialize a platform invoice', async () => {
    const context = createContext()
    context.payment.type = 'platform-fee'
    context.payment.payerId = 'landlord-1'
    context.payment.payerRole = 'landlord'
    context.payment.payeeRole = 'platform'
    context.payment.invoiceCode = 'INV-2609-000001'
    context.payment.dueDate = new Date('2026-10-05T00:00:00.000Z')

    await expect(
      context.service.initInvoicePayment(paymentId, tenantId)
    ).rejects.toThrow('PAYMENT_ACCESS_DENIED')

    context.attemptRepository.findOne.mockResolvedValueOnce(null)
    const result = await context.service.initInvoicePayment(
      paymentId,
      'landlord-1'
    )

    expect(result).toEqual(
      expect.objectContaining({
        invoiceCode: 'INV-2609-000001',
        purpose: 'PLATFORM_FEE',
      })
    )
    expect(result.payer.role).toBe('landlord')
    expect(result.payee.role).toBe('platform')
    expect(context.attemptRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ paymentType: 'invoice', paymentId })
    )
  })

  it('settles an invoice callback and replays without paying twice', async () => {
    const context = createContext()
    context.attempt.paymentType = 'invoice'
    context.payment.type = 'platform-fee'
    const body = {
      txRef: context.attempt.txRef,
      amount: context.attempt.amount,
      status: 'success' as const,
    }
    const timestamp = Date.now().toString()
    const headers = {
      timestamp,
      nonce: 'invoice-nonce',
      signature: context.service.signCallback(body, timestamp, 'invoice-nonce'),
    }

    const first = await context.service.handleInvoiceCallback(body, headers)
    expect(first.replayed).toBe(false)
    expect(context.payment.status).toBe('paid')
    expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: paymentId,
        action: 'recordPayment',
        dependencyKey: 'contract:contract-1:contract.activated',
      })
    )

    context.attempt.status = 'succeeded'
    const replay = await context.service.handleInvoiceCallback(body, headers)
    expect(replay.replayed).toBe(true)
    expect(context.paymentRepository.save).toHaveBeenCalledTimes(1)
  })

  it('rejects landlord deposit initialization before creating an attempt', async () => {
    const context = createContext()
    context.depositAgreementsService.getAgreement.mockResolvedValue({
      _id: new ObjectId(),
      agreementCode: 'DPA-1',
      tenantId,
      landlordId: 'landlord-1',
      amount: 2_000_000,
      status: 'accepted',
      tenantConsent: { consentedAt: new Date(), contentHash: 'hash' },
    })

    await expect(
      context.service.initDepositPayment('deposit-1', 'landlord-1')
    ).rejects.toThrow('PAYMENT_ACCESS_DENIED')
    expect(context.providerRegistry.createPaymentIntent).not.toHaveBeenCalled()
    expect(context.attemptRepository.save).not.toHaveBeenCalled()
  })

  it('uses the application contract for a deposit attempt before the agreement is linked', async () => {
    const context = createContext()
    context.depositAgreementsService.getAgreement.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      applicationId: 'application-1',
      linkedLeaseContractId: null,
      agreementCode: 'DPA-1',
      tenantId,
      amount: 2_000_000,
      status: 'accepted',
      tenantConsent: { consentedAt: new Date(), contentHash: 'hash' },
    })
    context.contractRepository.findOne.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439012'),
    })
    context.attemptRepository.findOne.mockResolvedValueOnce(null)

    await context.service.initDepositPayment('deposit-1', tenantId)

    expect(context.contractRepository.findOne).toHaveBeenCalledWith({
      where: { rentalApplicationId: 'application-1' },
    })
    expect(context.attemptRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: '507f1f77bcf86cd799439012',
      })
    )
  })

  it('returns the canonical deposit state only to the attempt owner', async () => {
    const context = createContext()
    context.attempt.paymentType = 'deposit'
    context.attempt.status = 'succeeded'
    context.depositAgreementsService.getAgreement.mockResolvedValue({
      status: 'paid',
    })

    await expect(
      context.service.getGatewayPaymentResult(context.attempt.txRef, tenantId)
    ).resolves.toEqual(
      expect.objectContaining({
        txRef: context.attempt.txRef,
        targetPaid: true,
        paymentType: 'deposit',
      })
    )
    expect(context.attemptRepository.findOne).toHaveBeenCalledWith({
      where: { txRef: context.attempt.txRef, userId: tenantId },
    })
  })

  it('does not reveal a payment result when the owner does not match', async () => {
    const context = createContext()
    context.attemptRepository.findOne.mockResolvedValueOnce(null)

    await expect(
      context.service.getGatewayPaymentResult(
        context.attempt.txRef,
        'other-user'
      )
    ).rejects.toThrow('PAYMENT_ATTEMPT_NOT_FOUND')
    expect(context.depositAgreementsService.getAgreement).not.toHaveBeenCalled()
    expect(context.paymentRepository.findOne).not.toHaveBeenCalled()
  })

  it('reads paid rent from the payment record', async () => {
    const context = createContext()
    context.payment.status = 'paid'

    await expect(
      context.service.getGatewayPaymentResult(context.attempt.txRef, tenantId)
    ).resolves.toMatchObject({ paymentType: 'rent', targetPaid: true })
  })

  it('reads settlement state only for the paying tenant', async () => {
    const context = createContext()
    context.attempt.paymentType = 'settlement'
    context.settlementRepository.findOne.mockResolvedValue({
      status: 'paid',
      tenantId,
    })

    await expect(
      context.service.getGatewayPaymentResult(context.attempt.txRef, tenantId)
    ).resolves.toMatchObject({ paymentType: 'settlement', targetPaid: true })
  })

  it('reuses a live deposit attempt once the agreement is payment-pending', async () => {
    const context = createContext()
    const depositAttempt = {
      ...context.attempt,
      paymentId: 'deposit-1',
      paymentType: 'deposit' as const,
      userId: tenantId,
      txRef: 'MOCK-DEPOSIT-1',
      expiresAt: new Date(Date.now() + 60_000),
    }
    context.depositAgreementsService.getAgreement.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      agreementCode: 'DPA-1',
      tenantId,
      landlordId: 'landlord-1',
      amount: depositAttempt.amount,
      status: 'payment-pending',
      tenantConsent: { consentedAt: new Date(), contentHash: 'hash' },
    })
    context.attemptRepository.findOne.mockResolvedValueOnce(depositAttempt)

    const result = await context.service.initDepositPayment(
      'deposit-1',
      tenantId
    )

    expect(result.txRef).toBe('MOCK-DEPOSIT-1')
    expect(result.deepLink).toContain('MOCK-DEPOSIT-1')
    expect(result).toEqual(
      expect.objectContaining({
        invoiceCode: 'DPA-1',
        purpose: 'DEPOSIT',
        total: depositAttempt.amount,
        currency: 'VND',
        simulation: true,
        qrFormat: 'simulated',
      })
    )
    expect(result.lines).toEqual([
      expect.objectContaining({
        kind: 'deposit',
        amount: depositAttempt.amount,
        paymentId: '507f1f77bcf86cd799439011',
      }),
    ])
    expect(context.providerRegistry.createPaymentIntent).not.toHaveBeenCalled()
    expect(
      context.depositAgreementsService.markPaymentPending
    ).not.toHaveBeenCalled()
  })

  it('returns the latest deposit payment request without creating a new attempt', async () => {
    const context = createContext()
    const agreementId = '507f1f77bcf86cd799439011'
    context.depositAgreementsService.getAgreement.mockResolvedValue({
      _id: new ObjectId(agreementId),
      agreementCode: 'DPA-REQUEST-1',
      tenantId,
      landlordId: 'landlord-1',
      amount: 2_000_000,
      status: 'payment-pending',
    })
    context.attempt.paymentId = agreementId
    context.attempt.paymentType = 'deposit'

    const result = await context.service.getDepositPaymentRequest(
      agreementId,
      tenantId,
      false
    )

    expect(result).toEqual(
      expect.objectContaining({
        invoiceCode: 'DPA-REQUEST-1',
        transferContent: 'TH DPA REQUEST 1',
      })
    )
    expect(result?.deepLink).toContain(context.attempt.txRef)
    expect(context.attemptRepository.findOne).toHaveBeenCalledWith({
      where: { paymentId: agreementId, paymentType: 'deposit' },
      order: { createdAt: 'DESC' },
    })
    expect(context.providerRegistry.createPaymentIntent).not.toHaveBeenCalled()
  })

  it('returns null when a payment has no request attempt yet', async () => {
    const context = createContext()
    context.attemptRepository.findOne.mockResolvedValueOnce(null)

    const result = await context.service.getPaymentRequest(
      paymentId,
      tenantId,
      false
    )

    expect(result).toBeNull()
  })

  it('initializes settlement payment with only unpaid line ids', async () => {
    const context = createContext()
    const settlementId = new ObjectId().toHexString()
    const paidPaymentId = new ObjectId().toHexString()
    const unpaidPaymentId = new ObjectId().toHexString()
    context.settlementRepository.findOne.mockResolvedValue({
      _id: new ObjectId(settlementId),
      contractId: 'contract-1',
      tenantId,
      landlordId: 'landlord-1',
      lines: [
        {
          kind: 'FIRST_RENT',
          amount: 1_000_000,
          paymentId: paidPaymentId,
          paidAt: new Date(),
        },
        {
          kind: 'DEPOSIT_TOPUP',
          amount: 2_000_000,
          paymentId: unpaidPaymentId,
          paidAt: null,
        },
      ],
      dueAt: new Date('2026-10-05T00:00:00.000Z'),
      status: 'partially-paid',
    })
    context.paymentRepository.findOne.mockImplementation(
      ({ where }: { where: { _id: ObjectId } }) =>
        Promise.resolve({
          ...context.payment,
          _id: where._id,
          amount:
            where._id.toHexString() === unpaidPaymentId ? 2_000_000 : 1_000_000,
          type: 'deposit-topup',
        })
    )

    context.attemptRepository.findOne.mockResolvedValueOnce(null)
    const result = await context.service.initSettlementPayment(
      settlementId,
      tenantId
    )

    expect(result.total).toBe(2_000_000)
    expect(result.lines).toHaveLength(1)
    expect(context.attemptRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentType: 'settlement',
        paymentIds: [unpaidPaymentId],
        amount: 2_000_000,
      })
    )
  })

  it('settles each unpaid settlement line once and replays safely', async () => {
    const context = createContext()
    const settlementId = new ObjectId().toHexString()
    const paidPaymentId = new ObjectId().toHexString()
    const unpaidPaymentId = new ObjectId().toHexString()
    const paidAt = new Date()
    const settlement = {
      _id: new ObjectId(settlementId),
      contractId: 'contract-1',
      tenantId,
      landlordId: 'landlord-1',
      lines: [
        {
          kind: 'FIRST_RENT',
          amount: 1_000_000,
          paymentId: paidPaymentId,
          paidAt,
        },
        {
          kind: 'DEPOSIT_TOPUP',
          amount: 2_000_000,
          paymentId: unpaidPaymentId,
          paidAt: null,
        },
      ],
      status: 'partially-paid' as 'partially-paid' | 'paid',
    }
    const paidPayment = {
      ...context.payment,
      _id: new ObjectId(paidPaymentId),
      amount: 1_000_000,
      status: 'paid' as const,
      paidAt,
    }
    const unpaidPayment = {
      ...context.payment,
      _id: new ObjectId(unpaidPaymentId),
      amount: 2_000_000,
      status: 'unpaid' as 'unpaid' | 'paid',
    }
    context.attempt.paymentType = 'settlement'
    context.attempt.paymentId = settlementId
    context.attempt.paymentIds = [paidPaymentId, unpaidPaymentId]
    context.attempt.amount = 3_000_000
    context.settlementRepository.findOne.mockResolvedValue(settlement)
    context.paymentRepository.findOne.mockImplementation(
      ({ where }: { where: { _id: ObjectId } }) =>
        Promise.resolve(
          where._id.toHexString() === paidPaymentId
            ? paidPayment
            : unpaidPayment
        )
    )
    const body = {
      txRef: context.attempt.txRef,
      amount: context.attempt.amount,
      status: 'success' as const,
    }
    const timestamp = Date.now().toString()
    const headers = {
      timestamp,
      nonce: 'settlement-nonce',
      signature: context.service.signCallback(
        body,
        timestamp,
        'settlement-nonce'
      ),
    }

    const first = await context.service.handleSettlementCallback(body, headers)

    expect(first.replayed).toBe(false)
    expect(paidPayment.paidAt).toBe(paidAt)
    expect(unpaidPayment.status).toBe('paid')
    expect(settlement.status).toBe('paid')
    expect(context.paymentRepository.save).toHaveBeenCalledTimes(1)
    expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: unpaidPaymentId,
        action: 'recordPayment',
        dependencyKey: 'contract:contract-1:contract.activated',
      })
    )

    context.attempt.status = 'succeeded'
    const replay = await context.service.handleSettlementCallback(body, headers)
    expect(replay.replayed).toBe(true)
    expect(context.paymentRepository.save).toHaveBeenCalledTimes(1)
  })

  describe('settlement paid transition evidence (PROP-399 D3, task 5.2)', () => {
    function settlementCallbackContext(
      lineStates: Array<'paid' | 'unpaid'>,
      initialStatus: 'partially-paid' | 'paid' = 'partially-paid',
      payOnly?: number
    ): {
      context: ReturnType<typeof createContext>
      settlement: {
        status: string
        lines: Array<{ paidAt: Date | null }>
      }
      evidence: { recordSettlementPaidEvidence: jest.Mock }
      call: () => Promise<{ replayed: boolean }>
    } {
      const context = createContext()
      const settlementId = new ObjectId().toHexString()
      const lines = lineStates.map(state => ({
        kind: 'FIRST_RENT' as const,
        amount: 1_000_000,
        paymentId: new ObjectId().toHexString(),
        paidAt: state === 'paid' ? new Date('2030-01-01') : null,
      }))
      const settlement = {
        _id: new ObjectId(settlementId),
        contractId: 'contract-1',
        tenantId,
        landlordId: 'landlord-1',
        lines,
        status: initialStatus,
      }
      const unpaid = lines
        .filter(line => !line.paidAt)
        .slice(0, payOnly ?? lines.length)
      context.attempt.paymentType = 'settlement'
      context.attempt.paymentId = settlementId
      context.attempt.paymentIds = unpaid.map(line => line.paymentId)
      context.attempt.amount = unpaid.length * 1_000_000
      context.settlementRepository.findOne.mockResolvedValue(settlement)
      context.paymentRepository.findOne.mockImplementation(
        ({ where }: { where: { _id: ObjectId } }) =>
          Promise.resolve({
            ...context.payment,
            _id: where._id,
            amount: 1_000_000,
            status: 'unpaid',
          })
      )
      const evidence = {
        recordSettlementPaidEvidence: jest.fn().mockResolvedValue(undefined),
      }
      Reflect.set(context.service, 'moveInSettlementsService', evidence)
      const body = {
        txRef: context.attempt.txRef,
        amount: context.attempt.amount,
        status: 'success' as const,
      }
      const timestamp = Date.now().toString()
      const headers = {
        timestamp,
        nonce: 'settlement-evidence-nonce',
        signature: context.service.signCallback(
          body,
          timestamp,
          'settlement-evidence-nonce'
        ),
      }
      return {
        context,
        settlement,
        evidence,
        call: () => context.service.handleSettlementCallback(body, headers),
      }
    }

    it('produces settlement evidence exactly once when the callback completes the settlement, after the business state is saved', async () => {
      const { context, settlement, evidence, call } = settlementCallbackContext(
        ['paid', 'unpaid']
      )

      await call()

      expect(settlement.status).toBe('paid')
      expect(evidence.recordSettlementPaidEvidence).toHaveBeenCalledTimes(1)
      expect(evidence.recordSettlementPaidEvidence).toHaveBeenCalledWith(
        settlement
      )
      expect(
        context.settlementRepository.save.mock.invocationCallOrder[0]
      ).toBeLessThan(
        evidence.recordSettlementPaidEvidence.mock.invocationCallOrder[0] ??
          Infinity
      )

      context.attempt.status = 'succeeded'
      const replay = await call()
      expect(replay.replayed).toBe(true)
      expect(evidence.recordSettlementPaidEvidence).toHaveBeenCalledTimes(1)
    })

    it('produces no evidence while lines remain unpaid (partially-paid)', async () => {
      const { settlement, evidence, call } = settlementCallbackContext(
        ['paid', 'unpaid', 'unpaid'],
        'partially-paid',
        1
      )
      await call()
      expect(settlement.status).toBe('partially-paid')
      expect(evidence.recordSettlementPaidEvidence).not.toHaveBeenCalled()
    })

    it('does not produce evidence for a settlement that was already paid before the callback', async () => {
      const { evidence, call } = settlementCallbackContext(
        ['paid', 'paid'],
        'paid'
      )
      await call().catch(() => undefined)
      expect(evidence.recordSettlementPaidEvidence).not.toHaveBeenCalled()
    })

    it('never fails the callback because the evidence producer failed', async () => {
      const { evidence, call } = settlementCallbackContext(['paid', 'unpaid'])
      evidence.recordSettlementPaidEvidence.mockRejectedValue(
        new Error('outbox down')
      )
      await expect(call()).resolves.toMatchObject({ replayed: false })
    })
  })

  it('rejects a settlement callback whose amount differs from the attempt', async () => {
    const context = createContext()
    context.attempt.paymentType = 'settlement'
    const body = {
      txRef: context.attempt.txRef,
      amount: context.attempt.amount - 1,
      status: 'success' as const,
    }
    const timestamp = Date.now().toString()
    const headers = {
      timestamp,
      nonce: 'settlement-wrong-amount',
      signature: context.service.signCallback(
        body,
        timestamp,
        'settlement-wrong-amount'
      ),
    }

    await expect(
      context.service.handleSettlementCallback(body, headers)
    ).rejects.toThrow('BANK_AMOUNT_MISMATCH')
    expect(context.settlementRepository.save).not.toHaveBeenCalled()
  })

  it('expires a stale deposit attempt before creating a replacement', async () => {
    const context = createContext()
    const staleAttempt = {
      ...context.attempt,
      paymentId: 'deposit-1',
      paymentType: 'deposit' as const,
      userId: tenantId,
      status: 'pending' as const,
      expiresAt: new Date(Date.now() - 60_000),
    }
    context.depositAgreementsService.getAgreement.mockResolvedValue({
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      agreementCode: 'DPA-1',
      tenantId,
      landlordId: 'landlord-1',
      amount: staleAttempt.amount,
      status: 'payment-pending',
      tenantConsent: { consentedAt: new Date(), contentHash: 'hash' },
    })
    context.attemptRepository.findOne.mockResolvedValueOnce(staleAttempt)

    await context.service.initDepositPayment('deposit-1', tenantId)

    expect(staleAttempt.status).toBe('expired')
    expect(context.attemptRepository.save).toHaveBeenCalledWith(staleAttempt)
    expect(context.providerRegistry.createPaymentIntent).toHaveBeenCalledTimes(
      1
    )
  })

  it('rejects a callback with an invalid HMAC before any business mutation', async () => {
    const { service, walletRepository } = createContext()
    const body = {
      txRef: 'MOCK-RENT-1',
      amount: 2_000_000,
      status: 'success' as const,
    }

    await expect(
      service.handleRentCallback(body, {
        timestamp: Date.now().toString(),
        nonce: 'nonce-1',
        signature: 'invalid',
      })
    ).rejects.toThrow('INVALID_BANK_SIGNATURE')
    expect(walletRepository.manager.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('confirms a valid callback once and returns the previous result on replay', async () => {
    const {
      service,
      attempt,
      payment,
      attemptRepository,
      paymentRepository,
      ledgerOutboxService,
    } = createContext()
    const body = {
      txRef: attempt.txRef,
      amount: attempt.amount,
      status: 'success' as const,
    }
    const timestamp = Date.now().toString()
    const headers = {
      timestamp,
      nonce: 'nonce-1',
      signature: service.signCallback(body, timestamp, 'nonce-1'),
    }

    const first = await service.handleRentCallback(body, headers)
    expect(first.replayed).toBe(false)
    expect(payment.status).toBe('paid')
    expect(payment.receiptCode).toMatch(/^RCP-[A-Z2-7]{11}$/)
    expect(payment.receiptHash).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            receiptCode: payment.receiptCode,
            paymentId: payment._id.toHexString(),
            contractId: payment.contractId,
            type: payment.type ?? 'rent',
            amount: payment.amount,
            vat: payment.vatAmount ?? 0,
            paidAt: payment.paidAt?.toISOString(),
            txRef: payment.txRef,
          })
        )
        .digest('hex')
    )
    expect(paymentRepository.save).toHaveBeenCalled()
    expect(ledgerOutboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recordPayment',
        dependencyKey: 'contract:contract-1:contract.activated',
        args: [
          payment._id.toHexString(),
          expect.any(String),
          payment.amount.toString(),
          expect.stringMatching(/^[a-f0-9]{64}$/),
        ],
      })
    )

    attempt.status = 'succeeded'
    const second = await service.handleRentCallback(body, headers)
    expect(second.replayed).toBe(true)
    expect(attemptRepository.save).toHaveBeenCalledTimes(1)
  })

  it('records exactly one payment.succeeded transaction event across a replayed rent callback', async () => {
    const context = createContext()
    const { service, attempt } = context
    const body = {
      txRef: attempt.txRef,
      amount: attempt.amount,
      status: 'success' as const,
    }
    const timestamp = Date.now().toString()
    const headers = {
      timestamp,
      nonce: 'nonce-audit',
      signature: service.signCallback(body, timestamp, 'nonce-audit'),
    }
    const { service: transactionEventService, events } =
      createInMemoryTransactionEventService()
    Reflect.set(service, 'transactionEventService', transactionEventService)

    await service.handleRentCallback(body, headers)
    await service.handleRentCallback(body, headers)

    expect(attempt.status).toBe('succeeded')
    const succeededEvents = events.filter(
      event => event.eventType === 'payment.succeeded'
    )
    expect(succeededEvents).toHaveLength(1)
  })

  it('records a paid deposit and enqueues one hashed deposit ledger event', async () => {
    const context = createContext()
    const agreement = {
      _id: new ObjectId(),
      applicationId: 'application-1',
      amount: context.attempt.amount,
    }
    context.attempt.paymentType = 'deposit'
    context.depositAgreementsService.getAgreement.mockResolvedValue({
      status: 'payment-pending',
      paymentAttemptId: null,
    })
    context.depositAgreementsService.recordDepositPaid.mockResolvedValue(
      agreement
    )
    const body = {
      txRef: context.attempt.txRef,
      amount: context.attempt.amount,
      status: 'success' as const,
    }
    const timestamp = Date.now().toString()
    const headers = {
      timestamp,
      nonce: 'nonce-deposit',
      signature: context.service.signCallback(body, timestamp, 'nonce-deposit'),
    }

    await context.service.handleDepositCallback(body, headers)

    expect(
      context.depositAgreementsService.recordDepositPaid
    ).toHaveBeenCalledWith(
      context.attempt.paymentId,
      context.attempt._id.toString(),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.anything()
    )
    const receiptCall = context.depositAgreementsService.recordDepositPaid.mock
      .calls[0] as unknown[]
    const receipt = receiptCall[3] as {
      receiptCode: string
      receiptHash: string
      paidAt: Date
    }
    expect(receipt.receiptCode).toMatch(/^RCP-[A-Z2-7]{11}$/)
    expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.paidAt).toBeInstanceOf(Date)
    expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recordDeposit',
        args: [
          agreement._id.toHexString(),
          agreement._id.toHexString(),
          'application-1',
          String(agreement.amount),
          expect.stringMatching(/^[a-f0-9]{64}$/),
        ],
      })
    )
  })

  it('allows contract participants to read a receipt and rejects third parties', async () => {
    const context = createContext()
    context.payment.status = 'paid'
    context.payment.paidAt = new Date('2026-09-30T00:00:00.000Z')
    context.payment.txRef = 'MOCK-RECEIPT-1'
    context.payment.receiptCode = 'RCP-ABCDEFGHIJK'
    context.payment.receiptHash = 'a'.repeat(64)

    await expect(
      context.service.getPaymentReceipt(paymentId, 'stranger', false)
    ).rejects.toThrow('PAYMENT_ACCESS_DENIED')

    const receipt = await context.service.getPaymentReceipt(
      paymentId,
      tenantId,
      false
    )
    expect(receipt).toEqual(
      expect.objectContaining({
        receiptCode: 'RCP-ABCDEFGHIJK',
        receiptHash: 'a'.repeat(64),
        amount: context.payment.amount,
        txRef: 'MOCK-RECEIPT-1',
      })
    )
  })

  it('rejects a callback when the amount differs from the attempt', async () => {
    const { service } = createContext()
    const body = {
      txRef: 'MOCK-RENT-1',
      amount: 1_000_000,
      status: 'success' as const,
    }
    const timestamp = Date.now().toString()
    const headers = {
      timestamp,
      nonce: 'nonce-2',
      signature: service.signCallback(body, timestamp, 'nonce-2'),
    }

    await expect(
      service.handleRentCallback(body, headers)
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects callbacks outside the replay window', async () => {
    const { service } = createContext()
    const body = {
      txRef: 'MOCK-RENT-1',
      amount: 2_000_000,
      status: 'success' as const,
    }
    const timestamp = (Date.now() - 6 * 60 * 1000).toString()
    const headers = {
      timestamp,
      nonce: 'nonce-expired',
      signature: service.signCallback(body, timestamp, 'nonce-expired'),
    }

    await expect(service.handleRentCallback(body, headers)).rejects.toThrow(
      'BANK_CALLBACK_EXPIRED'
    )
  })

  it('does not mutate a wallet balance because the wallet is only a provider link projection', async () => {
    const { service, walletRepository } = createContext()
    const body = {
      txRef: 'MOCK-RENT-1',
      amount: 2_000_000,
      status: 'success' as const,
    }
    const timestamp = Date.now().toString()
    const headers = {
      timestamp,
      nonce: 'nonce-no-custody',
      signature: service.signCallback(body, timestamp, 'nonce-no-custody'),
    }

    await expect(service.handleRentCallback(body, headers)).resolves.toEqual(
      expect.objectContaining({ status: 'succeeded' })
    )
    expect(walletRepository.manager.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('fails closed when an unimplemented external provider is selected', async () => {
    const context = createContext()
    context.providerRegistry.get.mockImplementation(() => {
      throw new BadRequestException('PAYMENT_PROVIDER_NOT_ENABLED')
    })

    await expect(
      context.service.initRentPayment(paymentId, tenantId, {
        provider: 'techcombank',
      })
    ).rejects.toThrow('PAYMENT_PROVIDER_NOT_ENABLED')
    expect(context.attemptRepository.save).not.toHaveBeenCalled()
  })

  describe('settleVerifiedAttempt (gateway dispatcher)', () => {
    const success = { succeeded: true, providerTransactionId: 'GW-1' }

    it('replays an already-succeeded attempt without side effects', async () => {
      const context = createContext()
      context.attempt.status = 'succeeded'

      await expect(
        context.service.settleVerifiedAttempt(
          context.attempt as never,
          success,
          'digest'
        )
      ).resolves.toBe('replayed')
      expect(context.attemptRepository.update).not.toHaveBeenCalled()
      expect(context.paymentRepository.save).not.toHaveBeenCalled()
    })

    it('marks a pending attempt failed on a verified unsuccessful result', async () => {
      const context = createContext()

      await expect(
        context.service.settleVerifiedAttempt(
          context.attempt as never,
          { succeeded: false, providerTransactionId: null },
          'digest'
        )
      ).resolves.toBe('failed')
      expect(context.attemptRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' })
      )
      expect(context.paymentRepository.save).not.toHaveBeenCalled()
    })

    it('settles exactly once when IPN and browser return race', async () => {
      const context = createContext()
      context.attemptRepository.update
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected: 0 })
      const first = { ...context.attempt }
      const second = { ...context.attempt }

      const outcomes = await Promise.all([
        context.service.settleVerifiedAttempt(first as never, success, 'a'),
        context.service.settleVerifiedAttempt(second as never, success, 'b'),
      ])

      expect(outcomes.sort()).toEqual(['replayed', 'settled'])
      expect(context.paymentRepository.save).toHaveBeenCalledTimes(1)
      expect(context.paymentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'paid', txRef: 'MOCK-RENT-1' })
      )
      expect(first).toMatchObject({
        status: 'succeeded',
        providerTransactionId: 'GW-1',
      })
    })

    it('settles a late success on an expired attempt while the target is unpaid', async () => {
      const context = createContext()
      context.attempt.status = 'expired' as never

      await expect(
        context.service.settleVerifiedAttempt(
          context.attempt as never,
          success,
          'digest'
        )
      ).resolves.toBe('settled')
      expect(context.paymentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'paid' })
      )
    })

    it('records duplicate-paid instead of paying a target settled elsewhere', async () => {
      const context = createContext()
      const events = { record: jest.fn().mockResolvedValue(undefined) }
      Object.assign(context.service, { transactionEventService: events })
      context.attempt.status = 'expired' as never
      context.payment.status = 'paid'
      Object.assign(context.payment, { txRef: 'ZALOPAY-OTHER' })

      await expect(
        context.service.settleVerifiedAttempt(
          context.attempt as never,
          success,
          'digest'
        )
      ).resolves.toBe('duplicate-paid')
      expect(context.paymentRepository.save).not.toHaveBeenCalled()
      expect(context.ledgerOutboxService.enqueue).not.toHaveBeenCalled()
      expect(context.attempt.status).toBe('succeeded')
      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'payment-attempt.duplicate-paid',
          refs: expect.objectContaining({
            txRef: 'MOCK-RENT-1',
            amount: '2000000',
          }) as unknown,
        })
      )
    })

    it('releases the lock when settlement throws', async () => {
      const context = createContext()
      context.paymentRepository.findOne.mockResolvedValue(null)

      await expect(
        context.service.settleVerifiedAttempt(
          context.attempt as never,
          success,
          'digest'
        )
      ).rejects.toThrow('PAYMENT_NOT_FOUND')
      expect(context.attemptRepository.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'processing' }),
        { status: 'pending' }
      )
    })
  })

  describe('createAttempt reuse and gateway switching', () => {
    it('reuses a live same-provider attempt without calling the gateway', async () => {
      const context = createContext()

      const result = await context.service.initRentPayment(paymentId, tenantId)

      expect(result.txRef).toBe('MOCK-RENT-1')
      expect(
        context.providerRegistry.createPaymentIntent
      ).not.toHaveBeenCalled()
      expect(context.attemptRepository.save).not.toHaveBeenCalled()
    })

    it('expires the live attempt and creates a new one when the provider changes', async () => {
      const context = createContext()
      const vnpayAdapter = {
        name: 'vnpay' as const,
        newTxRef: jest.fn().mockReturnValue('VNPAY-new'),
        createPaymentIntent: jest.fn().mockResolvedValue({
          provider: 'vnpay',
          txRef: 'VNPAY-new',
          redirectUrl: 'https://sandbox.vnpayment.vn/pay?x=1',
          expiresAt: new Date(Date.now() + 60_000),
        }),
      }
      context.providerRegistry.get.mockReturnValue(vnpayAdapter)

      const result = await context.service.initRentPayment(
        paymentId,
        tenantId,
        { provider: 'vnpay', clientChannel: 'mobile', clientIp: '10.0.0.1' }
      )

      expect(result).toMatchObject({
        provider: 'vnpay',
        txRef: 'VNPAY-new',
        deepLink: 'https://sandbox.vnpayment.vn/pay?x=1',
      })
      expect(context.attemptRepository.save).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ txRef: 'MOCK-RENT-1', status: 'expired' })
      )
      expect(context.attemptRepository.save).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          provider: 'vnpay',
          txRef: 'VNPAY-new',
          clientChannel: 'mobile',
          status: 'pending',
        })
      )
      expect(vnpayAdapter.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({ txRef: 'VNPAY-new', clientIp: '10.0.0.1' })
      )
    })

    it('creates a new MoMo attempt when the tenant switches MoMo method', async () => {
      const context = createContext()
      context.attemptRepository.findOne.mockResolvedValueOnce({
        _id: new ObjectId(),
        provider: 'momo',
        txRef: 'MOMO-wallet',
        momoMethod: 'wallet',
        status: 'pending',
        amount: 2_000_000,
        expiresAt: new Date(Date.now() + 60_000),
      })
      const momoAdapter = {
        name: 'momo' as const,
        newTxRef: jest.fn().mockReturnValue('MOMO-card'),
        createPaymentIntent: jest.fn().mockResolvedValue({
          provider: 'momo',
          txRef: 'MOMO-card',
          redirectUrl: 'https://test-payment.momo.vn/pay?card=1',
          expiresAt: new Date(Date.now() + 60_000),
        }),
      }
      context.providerRegistry.get.mockReturnValue(momoAdapter)

      await context.service.initRentPayment(paymentId, tenantId, {
        provider: 'momo',
        momoMethod: 'card',
      })

      expect(context.attemptRepository.save).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ txRef: 'MOMO-wallet', status: 'expired' })
      )
      expect(momoAdapter.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({ momoMethod: 'card' })
      )
      expect(context.attemptRepository.save).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ txRef: 'MOMO-card', momoMethod: 'card' })
      )
    })

    it('writes nothing when the gateway rejects the create request', async () => {
      const context = createContext()
      context.attemptRepository.findOne.mockResolvedValueOnce(null)
      context.providerRegistry.createPaymentIntent.mockRejectedValueOnce(
        new Error('PAYMENT_GATEWAY_UNAVAILABLE')
      )

      await expect(
        context.service.initRentPayment(paymentId, tenantId)
      ).rejects.toThrow('PAYMENT_GATEWAY_UNAVAILABLE')
      expect(context.attemptRepository.save).not.toHaveBeenCalled()
    })

    it('does not mark the deposit payment-pending when the gateway fails', async () => {
      const context = createContext()
      context.depositAgreementsService.getAgreement.mockResolvedValue({
        _id: new ObjectId('507f1f77bcf86cd799439011'),
        agreementCode: 'DPA-1',
        tenantId,
        landlordId: 'landlord-1',
        amount: 5_000_000,
        status: 'accepted',
        tenantConsent: { consentedAt: new Date(), contentHash: 'hash' },
      })
      context.attemptRepository.findOne.mockResolvedValueOnce(null)
      context.providerRegistry.createPaymentIntent.mockRejectedValueOnce(
        new Error('PAYMENT_GATEWAY_UNAVAILABLE')
      )

      await expect(
        context.service.initDepositPayment('deposit-1', tenantId)
      ).rejects.toThrow('PAYMENT_GATEWAY_UNAVAILABLE')
      expect(
        context.depositAgreementsService.markPaymentPending
      ).not.toHaveBeenCalled()
      expect(context.attemptRepository.save).not.toHaveBeenCalled()
    })
  })
})
