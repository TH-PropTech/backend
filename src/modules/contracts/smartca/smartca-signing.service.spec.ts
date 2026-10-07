import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { RentalExecutionPolicyRef } from '../../rental-flow-config/rental-execution-policy.util'
import type { SmartCaCertificate } from './smartca.provider'
import { SmartCaSigningService } from './smartca-signing.service'

describe('SmartCaSigningService', () => {
  const contractId = new ObjectId().toHexString()
  const artifactHash = 'a'.repeat(64)
  const documentId = `contract-${contractId}-r1`
  const contract = {
    _id: new ObjectId(contractId),
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    status: 'awaiting-signature',
    contentLockedHash: artifactHash,
    deposit: 0,
    depositPaidAt: null,
    artifactRef: {
      artifactId: new ObjectId().toHexString(),
      revision: 1,
      templateKey: 'lease-vn',
      templateVersion: 1,
      hashSchemaVersion: 1,
      artifactHash,
      contentType: 'application/pdf' as const,
      lockedAt: new Date(),
    },
    executionPolicySnapshot: null as RentalExecutionPolicyRef | null,
  }
  const validCertificate: SmartCaCertificate = {
    serialNumber: 'SERIAL-001',
    status: 'ACTIVE',
    serviceType: 'SMART_CA',
    subject: 'CN=Test Tenant',
    issuer: 'CN=VNPT Test CA',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2099-01-01T00:00:00.000Z',
    isValid: true,
  }
  const signingInput = {
    idempotencyKey: 'request-1',
    certificateSerial: 'SERIAL-001',
  }
  const signingInputWithoutSerial = {
    idempotencyKey: signingInput.idempotencyKey,
  }

  type TestContext = {
    service: SmartCaSigningService
    contractRepository: { findOne: jest.Mock }
    sessionRepository: {
      findOne: jest.Mock
      create: jest.Mock
      save: jest.Mock
      remove: jest.Mock
    }
    kycRepository: { findOne: jest.Mock }
    provider: {
      listCertificates: jest.Mock
      requestSignature: jest.Mock
      getSignatureStatus: jest.Mock
    }
    contractsService: { recordSmartCaSignature: jest.Mock }
    artifactService: { resolveCanonicalArtifact: jest.Mock }
    depositConfirmationResolver: { resolve: jest.Mock }
    eventsPublisher: { publish: jest.Mock }
  }

  function context(contractValue: typeof contract = contract): TestContext {
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contractValue),
    }
    const sessionRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Record<string, unknown>) => ({
        _id: new ObjectId(),
        ...value,
      })),
      save: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
      remove: jest.fn().mockResolvedValue(true),
    }
    const kycRepository = {
      findOne: jest.fn().mockResolvedValue({
        userId: 'tenant-1',
        status: 'verified',
        idCardNumber: '000000000001',
      }),
    }
    const provider = {
      listCertificates: jest.fn().mockResolvedValue([validCertificate]),
      requestSignature: jest
        .fn()
        .mockImplementation((input: { transactionId: string }) =>
          Promise.resolve({
            transactionId: input.transactionId,
            transactionCode: 'transaction-code-redacted',
          })
        ),
      getSignatureStatus: jest.fn().mockResolvedValue({
        transactionId: 'provider-transaction',
        status: 'pending',
      }),
    }
    const contractsService = {
      recordSmartCaSignature: jest
        .fn()
        .mockResolvedValue({ status: 'awaiting-signature' }),
    }
    const artifactService = {
      resolveCanonicalArtifact: jest.fn().mockResolvedValue({
        reference: contractValue.artifactRef,
        bytes: Buffer.from('%PDF-1.7\ncanonical'),
        artifact: {},
      }),
    }
    const depositConfirmationResolver = {
      resolve: jest
        .fn()
        .mockResolvedValue({ confirmed: Boolean(contractValue.depositPaidAt) }),
    }
    const eventsPublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    }
    return {
      service: new SmartCaSigningService(
        contractRepository as never,
        sessionRepository as never,
        kycRepository as never,
        provider as never,
        contractsService as never,
        artifactService as never,
        depositConfirmationResolver as never,
        eventsPublisher
      ),
      contractRepository,
      sessionRepository,
      kycRepository,
      provider,
      contractsService,
      artifactService,
      depositConfirmationResolver,
      eventsPublisher,
    }
  }

  function firstCallArgument<T>(mock: jest.Mock): T {
    const calls = mock.mock.calls as unknown[][]
    const argument = calls[0]?.[0]
    if (argument === undefined) throw new Error('Expected mock call')
    return argument as T
  }

  afterEach(() => jest.clearAllMocks())

  it('orchestrates certificate and sign on one canonical artifact, returning pending session', async () => {
    const ctx = context()

    const result = await ctx.service.createSession(
      contractId,
      'tenant-1',
      signingInput
    )

    expect(ctx.artifactService.resolveCanonicalArtifact).toHaveBeenCalledWith(
      contract
    )
    expect(ctx.provider.listCertificates).toHaveBeenCalledWith('000000000001')
    expect(ctx.provider.requestSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactHash,
        signerCccd: '000000000001',
        certificateSerial: 'SERIAL-001',
        documentId,
      })
    )
    const transactionId = firstCallArgument<{ transactionId: string }>(
      ctx.provider.requestSignature
    ).transactionId

    expect(result).toEqual(
      expect.objectContaining({
        status: 'pending',
        signerId: 'tenant-1',
        artifactHash,
        providerTransactionId: transactionId,
        certificateSerial: 'SERIAL-001',
        documentId,
      })
    )
  })

  it('uses stable transaction and document identifiers for the same idempotency key', async () => {
    const first = context()
    const second = context()

    await first.service.createSession(contractId, 'tenant-1', signingInput)
    await second.service.createSession(contractId, 'tenant-1', signingInput)

    const firstRequest = firstCallArgument<{
      transactionId: string
      documentId: string
    }>(first.provider.requestSignature)
    const secondRequest = firstCallArgument<{
      transactionId: string
      documentId: string
    }>(second.provider.requestSignature)
    expect(secondRequest.transactionId).toBe(firstRequest.transactionId)
    expect(secondRequest.documentId).toBe(documentId)
    expect(firstRequest.documentId).toBe(documentId)
  })

  it.each([
    { kyc: null, code: 'SMARTCA_KYC_REQUIRED' },
    {
      kyc: { status: 'pending', idCardNumber: '000000000001' },
      code: 'SMARTCA_KYC_NOT_VERIFIED',
    },
    {
      kyc: { status: 'rejected', idCardNumber: '000000000001' },
      code: 'SMARTCA_KYC_NOT_VERIFIED',
    },
    {
      kyc: { status: 'verified', idCardNumber: ' ' },
      code: 'SMARTCA_KYC_NOT_VERIFIED',
    },
  ])(
    'rejects invalid KYC with $code before provider access',
    async ({ kyc, code }) => {
      const ctx = context()
      ctx.kycRepository.findOne.mockResolvedValue(kyc)

      await expect(
        ctx.service.createSession(contractId, 'tenant-1', signingInput)
      ).rejects.toThrow(code)
      expect(ctx.provider.listCertificates).not.toHaveBeenCalled()
      expect(ctx.provider.requestSignature).not.toHaveBeenCalled()
    }
  )

  it('returns only sanitized valid certificates to a contract participant', async () => {
    const ctx = context()
    ctx.provider.listCertificates.mockResolvedValue([
      validCertificate,
      { ...validCertificate, serialNumber: 'EXPIRED', isValid: false },
    ])

    await expect(
      ctx.service.listCertificates(contractId, 'tenant-1')
    ).resolves.toEqual({ certificates: [validCertificate] })
  })

  it('auto-selects one valid certificate and requires selection when multiple exist', async () => {
    const single = context()
    await single.service.createSession(
      contractId,
      'tenant-1',
      signingInputWithoutSerial
    )
    expect(single.provider.requestSignature).toHaveBeenCalledWith(
      expect.objectContaining({ certificateSerial: 'SERIAL-001' })
    )

    const multiple = context()
    multiple.provider.listCertificates.mockResolvedValue([
      validCertificate,
      { ...validCertificate, serialNumber: 'SERIAL-002' },
    ])
    let error: unknown
    try {
      await multiple.service.createSession(
        contractId,
        'tenant-1',
        signingInputWithoutSerial
      )
    } catch (caught: unknown) {
      error = caught
    }
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).getResponse()).toEqual(
      expect.objectContaining({
        message: 'SMARTCA_CERTIFICATE_SELECTION_REQUIRED',
        certificates: expect.arrayContaining([
          expect.objectContaining({ serialNumber: 'SERIAL-001' }),
        ]) as unknown,
      })
    )
  })

  it.each([
    [[] as SmartCaCertificate[]],
    [[{ ...validCertificate, isValid: false }]],
    [[validCertificate, { ...validCertificate }]],
  ])('rejects zero, invalid or duplicate certificates', async certificates => {
    const ctx = context()
    ctx.provider.listCertificates.mockResolvedValue(certificates)

    await expect(
      ctx.service.createSession(contractId, 'tenant-1', signingInput)
    ).rejects.toThrow('SMARTCA_CERTIFICATE_INVALID')
    expect(ctx.provider.requestSignature).not.toHaveBeenCalled()
  })

  it('rejects a certificate serial that does not belong to the participant', async () => {
    const ctx = context()

    await expect(
      ctx.service.createSession(contractId, 'tenant-1', {
        ...signingInput,
        certificateSerial: 'SERIAL-OTHER',
      })
    ).rejects.toThrow('SMARTCA_CERTIFICATE_INVALID')
  })

  it('propagates certificate provider unavailability without attempting to sign', async () => {
    const ctx = context()
    ctx.provider.listCertificates.mockRejectedValue(
      new ServiceUnavailableException('SMARTCA_PROVIDER_UNAVAILABLE')
    )

    await expect(
      ctx.service.createSession(contractId, 'tenant-1', signingInput)
    ).rejects.toThrow('SMARTCA_PROVIDER_UNAVAILABLE')
    expect(ctx.provider.requestSignature).not.toHaveBeenCalled()
  })

  it('rejects outsiders, unavailable artifacts and unmet deposit-first policy', async () => {
    const outsider = context()
    await expect(
      outsider.service.createSession(contractId, 'outsider', signingInput)
    ).rejects.toBeInstanceOf(ForbiddenException)

    const superseded = context()
    superseded.artifactService.resolveCanonicalArtifact.mockRejectedValue(
      new ConflictException('CONTRACT_ARTIFACT_SUPERSEDED')
    )
    await expect(
      superseded.service.createSession(contractId, 'tenant-1', signingInput)
    ).rejects.toThrow('CONTRACT_ARTIFACT_SUPERSEDED')

    const depositFirst = context({
      ...contract,
      deposit: 10_000,
      executionPolicySnapshot: {
        policyId: 'deposit-first',
        version: 1,
        strategy: 'DEPOSIT_FIRST',
        contentHash: 'policy-hash',
      },
    })
    await expect(
      depositFirst.service.createSession(contractId, 'tenant-1', signingInput)
    ).rejects.toThrow('EXECUTION_POLICY_DEPOSIT_REQUIRED_BEFORE_SIGNING')
  })

  it('allows deposit-first signing when the deposit agreement is paid even though contract.depositPaidAt is still null', async () => {
    const ctx = context({
      ...contract,
      deposit: 20_000_000,
      depositPaidAt: null,
      executionPolicySnapshot: {
        policyId: 'deposit-first',
        version: 1,
        strategy: 'DEPOSIT_FIRST',
        contentHash: 'policy-hash',
      },
    })
    ctx.depositConfirmationResolver.resolve.mockResolvedValue({
      confirmed: true,
      required: true,
      requiredAmount: 20_000_000,
      source: 'agreement',
      agreementId: 'agreement-1',
      agreementStatus: 'paid',
      paidAt: new Date('2026-09-01T00:00:00.000Z'),
    })

    const session = await ctx.service.createSession(
      contractId,
      'tenant-1',
      signingInput
    )

    expect(session.status).toBe('pending')
    expect(ctx.depositConfirmationResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ deposit: 20_000_000 })
    )
  })

  it('allows sign-first policy before deposit confirmation', async () => {
    const ctx = context({
      ...contract,
      deposit: 10_000,
      executionPolicySnapshot: {
        policyId: 'sign-first',
        version: 1,
        strategy: 'SIGN_FIRST',
        contentHash: 'policy-hash',
      },
    })

    await expect(
      ctx.service.createSession(contractId, 'tenant-1', signingInput)
    ).resolves.toEqual(expect.objectContaining({ status: 'pending' }))
  })

  it('reuses a pending session without another provider request when idempotencyKey matches', async () => {
    const ctx = context()
    const existing = {
      _id: new ObjectId(),
      contractId,
      signerId: 'tenant-1',
      artifactHash,
      providerTransactionId: 'existing-transaction',
      idempotencyKey: signingInput.idempotencyKey,
      status: 'pending' as const,
      documentId,
      expiresAt: new Date(Date.now() + 60_000),
    }
    ctx.sessionRepository.findOne.mockResolvedValue(existing)

    await expect(
      ctx.service.createSession(contractId, 'tenant-1', signingInput)
    ).resolves.toBe(existing)
    expect(ctx.provider.requestSignature).not.toHaveBeenCalled()
  })

  it('deletes the pending session and throws on definite VNPT rejection', async () => {
    const ctx = context()
    ctx.provider.requestSignature.mockRejectedValue(
      new UnprocessableEntityException('SMARTCA_CREDENTIAL_OR_REQUEST_REJECTED')
    )

    await expect(
      ctx.service.createSession(contractId, 'tenant-1', signingInput)
    ).rejects.toThrow('SMARTCA_CREDENTIAL_OR_REQUEST_REJECTED')

    expect(ctx.sessionRepository.remove).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    )
  })

  it('keeps a pre-persisted session recoverable when provider transport fails (network error)', async () => {
    const ctx = context()
    ctx.provider.requestSignature.mockRejectedValue(
      new ServiceUnavailableException('SMARTCA_PROVIDER_UNAVAILABLE')
    )

    await expect(
      ctx.service.createSession(contractId, 'tenant-1', signingInput)
    ).rejects.toThrow('SMARTCA_PROVIDER_UNAVAILABLE')
    expect(ctx.sessionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    )
    expect(ctx.sessionRepository.remove).not.toHaveBeenCalled()
  })

  it('polls and completes correctly just once', async () => {
    const ctx = context()
    const session = {
      _id: new ObjectId(),
      contractId,
      signerId: 'tenant-1',
      signerRole: 'tenant' as const,
      artifactHash,
      documentId,
      providerTransactionId: 'provider-transaction',
      status: 'pending' as 'pending' | 'signed',
      certificateSerial: validCertificate.serialNumber,
      certificateSubject: validCertificate.subject,
      certificateIssuer: validCertificate.issuer,
      expiresAt: new Date(Date.now() + 60_000),
    }
    ctx.sessionRepository.findOne.mockResolvedValue(session)
    ctx.provider.getSignatureStatus.mockResolvedValue({
      transactionId: 'provider-transaction',
      status: 'signed',
      signature: {
        documentId,
        signatureValue: 'polled-signature',
        signedAt: '2026-09-23T10:00:00.000Z',
      },
    })

    const result = await ctx.service.poll(
      contractId,
      session._id.toHexString(),
      'tenant-1',
      false
    )
    expect(result).toEqual(expect.objectContaining({ status: 'signed' }))
    expect(ctx.contractsService.recordSmartCaSignature).toHaveBeenCalledTimes(1)
    expect(ctx.eventsPublisher.publish).toHaveBeenCalledWith({
      contractId,
      sessionId: session._id.toHexString(),
      status: 'signed',
    })

    // Second poll on a signed session shouldn't change anything
    session.status = 'signed'
    await ctx.service.poll(
      contractId,
      session._id.toHexString(),
      'tenant-1',
      false
    )
    expect(ctx.contractsService.recordSmartCaSignature).toHaveBeenCalledTimes(1)
    expect(ctx.eventsPublisher.publish).toHaveBeenCalledTimes(1)
  })

  it('cancels pending sessions and leaves terminal sessions unchanged when polling', async () => {
    const ctx = context()
    const session = {
      _id: new ObjectId(),
      contractId,
      signerId: 'tenant-1',
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 60_000),
    }
    ctx.sessionRepository.findOne.mockResolvedValue(session)

    await ctx.service.cancelSession(
      contractId,
      session._id.toHexString(),
      'tenant-1',
      false
    )
    expect(session).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        providerStatus: 'cancelled',
      })
    )
    expect(ctx.eventsPublisher.publish).toHaveBeenCalledWith({
      contractId,
      sessionId: session._id.toHexString(),
      status: 'cancelled',
    })

    // Poll on cancelled session keeps it cancelled
    const result = await ctx.service.poll(
      contractId,
      session._id.toHexString(),
      'tenant-1',
      false
    )
    expect(result.status).toBe('cancelled')
    expect(ctx.eventsPublisher.publish).toHaveBeenCalledTimes(1)
  })

  it('publishes rejected and expired transitions but not pending status checks', async () => {
    const rejected = context()
    const rejectedSession = {
      _id: new ObjectId(),
      contractId,
      signerId: 'tenant-1',
      artifactHash,
      documentId,
      providerTransactionId: 'rejected-transaction',
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 60_000),
    }
    rejected.sessionRepository.findOne.mockResolvedValue(rejectedSession)
    rejected.provider.getSignatureStatus.mockResolvedValue({
      transactionId: 'rejected-transaction',
      status: 'rejected',
    })

    await rejected.service.poll(
      contractId,
      rejectedSession._id.toHexString(),
      'tenant-1',
      false
    )
    expect(rejected.eventsPublisher.publish).toHaveBeenCalledWith({
      contractId,
      sessionId: rejectedSession._id.toHexString(),
      status: 'rejected',
    })

    const pending = context()
    const pendingSession = {
      ...rejectedSession,
      _id: new ObjectId(),
      providerTransactionId: 'pending-transaction',
      status: 'pending' as const,
    }
    pending.sessionRepository.findOne.mockResolvedValue(pendingSession)
    await pending.service.poll(
      contractId,
      pendingSession._id.toHexString(),
      'tenant-1',
      false
    )
    expect(pending.eventsPublisher.publish).not.toHaveBeenCalled()

    const expired = context()
    const expiredSession = {
      ...pendingSession,
      _id: new ObjectId(),
      idempotencyKey: signingInput.idempotencyKey,
      expiresAt: new Date(Date.now() - 1),
    }
    expired.sessionRepository.findOne.mockResolvedValue(expiredSession)
    await expired.service.createSession(contractId, 'tenant-1', signingInput)
    expect(expired.eventsPublisher.publish).toHaveBeenCalledWith({
      contractId,
      sessionId: expiredSession._id.toHexString(),
      status: 'expired',
    })
  })

  it('keeps a successful signing transition when realtime publishing fails', async () => {
    const ctx = context()
    const session = {
      _id: new ObjectId(),
      contractId,
      signerId: 'tenant-1',
      signerRole: 'tenant' as const,
      artifactHash,
      documentId,
      providerTransactionId: 'provider-transaction',
      status: 'pending' as const,
      certificateSerial: validCertificate.serialNumber,
      expiresAt: new Date(Date.now() + 60_000),
    }
    ctx.sessionRepository.findOne.mockResolvedValue(session)
    ctx.provider.getSignatureStatus.mockResolvedValue({
      transactionId: 'provider-transaction',
      status: 'signed',
      signature: { documentId, signatureValue: 'signature' },
    })
    ctx.eventsPublisher.publish.mockRejectedValue(
      new Error('socket unavailable')
    )

    await expect(
      ctx.service.poll(contractId, session._id.toHexString(), 'tenant-1', false)
    ).resolves.toEqual(expect.objectContaining({ status: 'signed' }))
  })

  describe('handleWebhook', () => {
    it('ignores unknown transaction without throwing', async () => {
      const ctx = context()
      ctx.sessionRepository.findOne.mockResolvedValue(null)
      await expect(
        ctx.service.handleWebhook('unknown-txn')
      ).resolves.toBeUndefined()
    })

    it('ignores session lacking documentId without throwing', async () => {
      const ctx = context()
      ctx.sessionRepository.findOne.mockResolvedValue({
        providerTransactionId: 'txn-1',
        status: 'pending',
        documentId: null,
      })
      await expect(ctx.service.handleWebhook('txn-1')).resolves.toBeUndefined()
    })

    it('ignores status API error without throwing', async () => {
      const ctx = context()
      ctx.sessionRepository.findOne.mockResolvedValue({
        providerTransactionId: 'txn-1',
        status: 'pending',
        documentId,
      })
      ctx.provider.getSignatureStatus.mockRejectedValue(
        new Error('Network error')
      )
      await expect(ctx.service.handleWebhook('txn-1')).resolves.toBeUndefined()
    })

    it('handles webhook successfully and deduplicates in-flight calls', async () => {
      const ctx = context()
      const session = {
        _id: new ObjectId(),
        contractId,
        signerId: 'tenant-1',
        signerRole: 'tenant' as const,
        artifactHash,
        documentId,
        providerTransactionId: 'txn-1',
        status: 'pending' as 'pending' | 'signed',
        certificateSerial: validCertificate.serialNumber,
        expiresAt: new Date(Date.now() + 60_000),
      }
      ctx.sessionRepository.findOne.mockResolvedValue(session)
      ctx.provider.getSignatureStatus.mockResolvedValue({
        transactionId: 'txn-1',
        status: 'signed',
        signature: {
          documentId,
          signatureValue: 'polled-signature',
          signedAt: '2026-09-23T10:00:00.000Z',
        },
      })

      // Simulate concurrent calls
      await Promise.all([
        ctx.service.handleWebhook('txn-1'),
        ctx.service.handleWebhook('txn-1'),
      ])

      expect(ctx.provider.getSignatureStatus).toHaveBeenCalledTimes(1)
      expect(ctx.eventsPublisher.publish).toHaveBeenCalledTimes(1)
    })
  })

  it('rejects invalid contract and session identifiers', async () => {
    const ctx = context()

    await expect(
      ctx.service.createSession('invalid-id', 'tenant-1', signingInput)
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      ctx.service.getSession(contractId, 'invalid-id', 'tenant-1', false)
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
