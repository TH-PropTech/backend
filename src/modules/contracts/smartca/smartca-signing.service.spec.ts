import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createHash } from 'crypto'
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
    smartCaPassword: 'password-redacted',
    smartCaOtp: '000000',
  }
  const signingInputWithoutSerial = {
    idempotencyKey: signingInput.idempotencyKey,
    smartCaPassword: signingInput.smartCaPassword,
    smartCaOtp: signingInput.smartCaOtp,
  }

  type TestContext = {
    service: SmartCaSigningService
    contractRepository: { findOne: jest.Mock }
    sessionRepository: {
      findOne: jest.Mock
      create: jest.Mock
      save: jest.Mock
    }
    kycRepository: { findOne: jest.Mock }
    provider: {
      listCertificates: jest.Mock
      requestSignature: jest.Mock
      confirmSignature: jest.Mock
      getSignatureStatus: jest.Mock
    }
    contractsService: { recordSmartCaSignature: jest.Mock }
    artifactService: { resolveCanonicalArtifact: jest.Mock }
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
            sad: 'sad-redacted',
            expiresIn: 299,
          })
        ),
      confirmSignature: jest
        .fn()
        .mockImplementation(
          (input: { transactionId: string; documentId: string }) =>
            Promise.resolve({
              transactionId: input.transactionId,
              signature: {
                documentId: input.documentId,
                signatureValue: 'signature-value-redacted',
                signedAt: '2026-09-23T10:00:00.000Z',
              },
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
    return {
      service: new SmartCaSigningService(
        contractRepository as never,
        sessionRepository as never,
        kycRepository as never,
        provider as never,
        contractsService as never,
        artifactService as never
      ),
      contractRepository,
      sessionRepository,
      kycRepository,
      provider,
      contractsService,
      artifactService,
    }
  }

  function firstCallArgument<T>(mock: jest.Mock): T {
    const calls = mock.mock.calls as unknown[][]
    const argument = calls[0]?.[0]
    if (argument === undefined) throw new Error('Expected mock call')
    return argument as T
  }

  afterEach(() => jest.clearAllMocks())

  it('orchestrates certificate, sign and confirm on one canonical artifact', async () => {
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
        password: signingInput.smartCaPassword,
        otp: signingInput.smartCaOtp,
        certificateSerial: 'SERIAL-001',
        documentId,
      })
    )
    const transactionId = firstCallArgument<{ transactionId: string }>(
      ctx.provider.requestSignature
    ).transactionId
    expect(ctx.provider.confirmSignature).toHaveBeenCalledWith({
      transactionId,
      signerCccd: '000000000001',
      password: signingInput.smartCaPassword,
      sad: 'sad-redacted',
      documentId,
    })
    expect(result).toEqual(
      expect.objectContaining({
        status: 'signed',
        signerId: 'tenant-1',
        artifactHash,
        providerTransactionId: transactionId,
        certificateSerial: 'SERIAL-001',
      })
    )
    expect(ctx.contractsService.recordSmartCaSignature).toHaveBeenCalledTimes(1)
    const persistenceCalls = JSON.stringify(
      ctx.sessionRepository.save.mock.calls as unknown
    )
    expect(persistenceCalls).not.toContain(signingInput.smartCaPassword)
    expect(persistenceCalls).not.toContain(signingInput.smartCaOtp)
    expect(persistenceCalls).not.toContain('sad-redacted')
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
    ).resolves.toEqual(expect.objectContaining({ status: 'signed' }))
  })

  it('reuses a terminal idempotent session without another provider request', async () => {
    const ctx = context()
    const existing = {
      _id: new ObjectId(),
      contractId,
      signerId: 'tenant-1',
      artifactHash,
      providerTransactionId: 'existing-transaction',
      idempotencyKey: signingInput.idempotencyKey,
      status: 'signed' as const,
      expiresAt: new Date(Date.now() + 60_000),
    }
    ctx.sessionRepository.findOne.mockResolvedValue(existing)

    await expect(
      ctx.service.createSession(contractId, 'tenant-1', signingInput)
    ).resolves.toBe(existing)
    expect(ctx.provider.requestSignature).not.toHaveBeenCalled()
  })

  it('recovers an existing pending session through status before signing again', async () => {
    const ctx = context()
    const existing = {
      _id: new ObjectId(),
      contractId,
      signerId: 'tenant-1',
      signerRole: 'tenant' as const,
      artifactHash,
      providerTransactionId: 'provider-transaction',
      idempotencyKey: signingInput.idempotencyKey,
      status: 'pending' as 'pending' | 'signed',
      certificateSerial: validCertificate.serialNumber,
      certificateSubject: validCertificate.subject,
      certificateIssuer: validCertificate.issuer,
      expiresAt: new Date(Date.now() + 60_000),
    }
    ctx.sessionRepository.findOne.mockResolvedValue(existing)
    ctx.provider.getSignatureStatus.mockResolvedValue({
      transactionId: 'provider-transaction',
      status: 'signed',
      signature: {
        documentId,
        signatureValue: 'recovered-signature',
        signedAt: null,
      },
    })

    await expect(
      ctx.service.createSession(contractId, 'tenant-1', signingInput)
    ).resolves.toEqual(expect.objectContaining({ status: 'signed' }))
    expect(ctx.provider.getSignatureStatus).toHaveBeenCalledWith(
      'provider-transaction',
      documentId
    )
    expect(ctx.provider.requestSignature).not.toHaveBeenCalled()
  })

  it('keeps a pre-persisted session recoverable when provider transport fails', async () => {
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
  })

  it('hashes the signature value and uses backend verified time for a null provider timestamp', async () => {
    const ctx = context()
    ctx.provider.confirmSignature.mockImplementation(
      (input: { transactionId: string; documentId: string }) =>
        Promise.resolve({
          transactionId: input.transactionId,
          signature: {
            documentId: input.documentId,
            signatureValue: 'signature-value-redacted',
            signedAt: null,
          },
        })
    )

    const result = await ctx.service.createSession(
      contractId,
      'tenant-1',
      signingInput
    )

    expect(result.signatureHash).toBe(
      createHash('sha256').update('signature-value-redacted').digest('hex')
    )
    expect(result.signatureValueRef).toBe('signature-value-redacted')
    expect(result.signedAt).toBeInstanceOf(Date)
  })

  it('polls and reconciles a matching signature idempotently', async () => {
    const ctx = context()
    const session = {
      _id: new ObjectId(),
      contractId,
      signerId: 'tenant-1',
      signerRole: 'tenant' as const,
      artifactHash,
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

    await expect(
      ctx.service.poll(contractId, session._id.toHexString(), 'tenant-1', false)
    ).resolves.toEqual(expect.objectContaining({ status: 'signed' }))
    expect(ctx.contractsService.recordSmartCaSignature).toHaveBeenCalledTimes(1)

    session.status = 'signed'
    await ctx.service.poll(
      contractId,
      session._id.toHexString(),
      'tenant-1',
      false
    )
    expect(ctx.contractsService.recordSmartCaSignature).toHaveBeenCalledTimes(1)
  })

  it('rejects callback evidence for another artifact and makes terminal callbacks idempotent', async () => {
    const ctx = context()
    const session = {
      providerTransactionId: 'provider-transaction',
      artifactHash,
      status: 'pending' as 'pending' | 'signed',
      expiresAt: new Date(Date.now() + 60_000),
    }
    ctx.sessionRepository.findOne.mockResolvedValue(session)

    await expect(
      ctx.service.reconcile('provider-transaction', 'signed', {
        artifactHash: 'b'.repeat(64),
        certificateSerial: 'SERIAL-001',
      })
    ).rejects.toThrow('SMARTCA_SIGNATURE_DIGEST_MISMATCH')

    session.status = 'signed'
    await expect(
      ctx.service.reconcile('provider-transaction', 'rejected', {
        artifactHash: 'b'.repeat(64),
      })
    ).resolves.toBe(session)
  })

  it('cancels pending sessions and leaves terminal sessions unchanged', async () => {
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
