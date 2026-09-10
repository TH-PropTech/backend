import { ObjectId } from 'mongodb'
import { ConflictException } from '@nestjs/common'
import { MockBankService } from './mock-bank.service'

describe('MockBankService', () => {
  const paymentId = new ObjectId().toString()
  const tenantId = 'tenant-1'

  type TestAttempt = {
    _id: ObjectId
    provider: 'mock-bank'
    txRef: string
    paymentId: string
    paymentType: 'deposit' | 'rent'
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
  }

  function createContext(): {
    service: MockBankService
    attempt: TestAttempt
    payment: TestPayment
    attemptRepository: {
      findOne: jest.Mock
      create: jest.Mock
      save: jest.Mock
    }
    paymentRepository: { findOne: jest.Mock; save: jest.Mock }
    walletRepository: {
      findOne: jest.Mock
      create: jest.Mock
      save: jest.Mock
      manager: { findOneAndUpdate: jest.Mock }
    }
    providerRegistry: {
      assertMockProvider: jest.Mock
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
      create: jest.fn((input: unknown): unknown => input),
      save: jest.fn(
        (input: unknown): Promise<unknown> => Promise.resolve(input)
      ),
    }
    const paymentRepository = {
      findOne: jest.fn().mockResolvedValue(payment),
      save: jest.fn(
        (input: unknown): Promise<unknown> => Promise.resolve(input)
      ),
    }
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
    const providerRegistry = {
      assertMockProvider: jest.fn(),
      getAccountLink: jest.fn().mockResolvedValue({
        provider: 'mock-bank',
        externalAccountRef: `mock-account:${tenantId}`,
        status: 'linked',
        simulation: true,
      }),
      createPaymentIntent: jest.fn().mockResolvedValue({
        provider: 'mock-bank',
        txRef: 'MOCK-1',
        redirectUrl: 'mockbank://pay?txRef=MOCK-1&amount=2000000',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    }
    const ledgerOutboxService = { enqueue: jest.fn().mockResolvedValue({}) }
    const service = new MockBankService(
      depositAgreementsService as never,
      paymentRepository as never,
      attemptRepository as never,
      walletRepository as never,
      providerRegistry as never,
      configService as never,
      ledgerOutboxService as never
    )
    return {
      service,
      attempt,
      payment,
      attemptRepository,
      paymentRepository,
      walletRepository,
      providerRegistry,
      configService,
      ledgerOutboxService,
      depositAgreementsService,
    }
  }

  it('creates a rent payment attempt from server-side invoice data', async () => {
    const { service, attemptRepository } = createContext()

    const result = await service.initRentPayment(paymentId, tenantId)

    expect(result.amount).toBe(2_000_000)
    expect(result.deepLink).toContain('MOCK-1')
    expect(attemptRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ paymentType: 'rent', amount: 2_000_000 })
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
    expect(paymentRepository.save).toHaveBeenCalled()
    expect(ledgerOutboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recordPayment',
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

  it('records a paid deposit and enqueues one hashed deposit ledger event', async () => {
    const context = createContext()
    const agreement = {
      _id: new ObjectId(),
      applicationId: 'application-1',
      amount: context.attempt.amount,
    }
    context.attempt.paymentType = 'deposit'
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
      expect.stringMatching(/^[a-f0-9]{64}$/)
    )
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
    context.providerRegistry.assertMockProvider.mockImplementation(() => {
      throw new Error('BANK_PROVIDER_ADAPTER_NOT_CONFIGURED')
    })

    await expect(
      context.service.initRentPayment(paymentId, tenantId)
    ).rejects.toThrow('BANK_PROVIDER_ADAPTER_NOT_CONFIGURED')
  })
})
