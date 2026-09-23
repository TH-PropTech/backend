import { ConflictException, ForbiddenException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { SmartCaSigningService } from './smartca-signing.service'
import type { RentalExecutionPolicyRef } from '../../rental-flow-config/rental-execution-policy.util'

describe('SmartCaSigningService', () => {
  const contractId = new ObjectId().toHexString()
  const contract = {
    _id: new ObjectId(contractId),
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    status: 'awaiting-signature',
    contentLockedHash: 'a'.repeat(64),
    deposit: 0,
    depositPaidAt: null,
    artifactRef: {
      artifactId: new ObjectId().toHexString(),
      revision: 1,
      templateKey: 'lease-vn',
      templateVersion: 1,
      hashSchemaVersion: 1,
      artifactHash: 'a'.repeat(64),
      contentType: 'application/pdf' as const,
      lockedAt: new Date(),
    },
    executionPolicySnapshot: null as RentalExecutionPolicyRef | null,
  }
  function context(contractValue = contract): {
    service: SmartCaSigningService
    provider: { requestSignature: jest.Mock }
    artifactService: { resolveCanonicalArtifact: jest.Mock }
    sessionRepository: {
      findOne: jest.Mock
      create: jest.Mock
      save: jest.Mock
    }
  } {
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contractValue),
    }
    const sessionRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
    }
    const provider = {
      requestSignature: jest
        .fn()
        .mockResolvedValue({ transactionId: 'sca-1', status: 'pending' }),
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
        provider as never,
        undefined,
        artifactService as never
      ),
      provider,
      artifactService,
      sessionRepository,
    }
  }

  it('creates a participant-bound pending session for the locked digest', async () => {
    const { service, provider, artifactService } = context()
    const result = await service.createSession(contractId, 'tenant-1')
    expect(provider.requestSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactHash: 'a'.repeat(64),
        signerRole: 'tenant',
      })
    )
    expect(artifactService.resolveCanonicalArtifact).toHaveBeenCalledWith(
      contract
    )
    expect(result).toEqual(
      expect.objectContaining({
        providerTransactionId: 'sca-1',
        signerId: 'tenant-1',
      })
    )
  })

  it('retains provider signature algorithm and value reference metadata', async () => {
    const { service, provider } = context()
    provider.requestSignature.mockResolvedValue({
      transactionId: 'sca-evidence-1',
      status: 'pending',
      signatureAlgorithm: 'RSA-PSS-SHA256',
      signatureValueRef: 'provider-signature-1',
    })

    const result = await service.createSession(contractId, 'tenant-1')

    expect(result).toEqual(
      expect.objectContaining({
        signatureAlgorithm: 'RSA-PSS-SHA256',
        signatureValueRef: 'provider-signature-1',
      })
    )
  })

  it('does not send a signing request for an unavailable or superseded artifact', async () => {
    const { service, artifactService, provider } = context()
    artifactService.resolveCanonicalArtifact.mockRejectedValue(
      new ConflictException('CONTRACT_ARTIFACT_SUPERSEDED')
    )

    await expect(service.createSession(contractId, 'tenant-1')).rejects.toThrow(
      'CONTRACT_ARTIFACT_SUPERSEDED'
    )
    expect(provider.requestSignature).not.toHaveBeenCalled()
  })

  it('rejects outsiders and contracts that are not ready', async () => {
    const { service } = context()
    await expect(
      service.createSession(contractId, 'outsider')
    ).rejects.toBeInstanceOf(ForbiddenException)
    const notReady = context(Object.assign({}, contract, { status: 'draft' }))
    await expect(
      notReady.service.createSession(contractId, 'tenant-1')
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects SmartCA before deposit for the deposit-first policy', async () => {
    const { service, provider } = context({
      ...contract,
      deposit: 10_000,
      depositPaidAt: null,
      executionPolicySnapshot: {
        policyId: 'deposit-first',
        version: 1,
        strategy: 'DEPOSIT_FIRST',
        contentHash: 'policy-hash',
      },
    })

    await expect(service.createSession(contractId, 'tenant-1')).rejects.toThrow(
      'EXECUTION_POLICY_DEPOSIT_REQUIRED_BEFORE_SIGNING'
    )
    expect(provider.requestSignature).not.toHaveBeenCalled()
  })

  it('allows SmartCA before deposit for the sign-first policy', async () => {
    const { service, provider } = context({
      ...contract,
      deposit: 10_000,
      depositPaidAt: null,
      executionPolicySnapshot: {
        policyId: 'sign-first',
        version: 1,
        strategy: 'SIGN_FIRST',
        contentHash: 'policy-hash',
      },
    })

    await expect(
      service.createSession(contractId, 'tenant-1')
    ).resolves.toEqual(expect.objectContaining({ signerId: 'tenant-1' }))
    expect(provider.requestSignature).toHaveBeenCalledTimes(1)
  })

  it('reuses a pending idempotent session without creating a provider transaction', async () => {
    const existing = {
      contractId,
      signerId: 'tenant-1',
      signerRole: 'tenant' as const,
      artifactHash: 'a'.repeat(64),
      providerTransactionId: 'sca-existing',
      status: 'pending' as const,
      idempotencyKey: 'request-1',
      expiresAt: new Date(Date.now() + 60_000),
    }
    const repository = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const provider = { requestSignature: jest.fn() }
    const service = new SmartCaSigningService(
      { findOne: jest.fn().mockResolvedValue(contract) } as never,
      repository as never,
      provider as never
    )

    await expect(
      service.createSession(contractId, 'tenant-1', 'request-1')
    ).resolves.toBe(existing)
    expect(provider.requestSignature).not.toHaveBeenCalled()
  })

  it('expires a stale session before creating a replacement without an idempotency key', async () => {
    const stale = {
      contractId,
      signerId: 'landlord-1',
      signerRole: 'landlord' as const,
      artifactHash: 'a'.repeat(64),
      providerTransactionId: 'sca-stale',
      status: 'pending' as const,
      expiresAt: new Date(Date.now() - 1),
    }
    const repository = {
      findOne: jest.fn().mockResolvedValue(stale),
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const provider = {
      requestSignature: jest
        .fn()
        .mockResolvedValue({ transactionId: 'sca-new', status: 'pending' }),
    }
    const service = new SmartCaSigningService(
      { findOne: jest.fn().mockResolvedValue(contract) } as never,
      repository as never,
      provider as never
    )

    const result = await service.createSession(contractId, 'landlord-1')
    expect(stale.status).toBe('expired')
    expect(provider.requestSignature).toHaveBeenCalledWith(
      expect.objectContaining({ signerRole: 'landlord' })
    )
    expect(result.providerTransactionId).toBe('sca-new')
  })

  it('persists certificate evidence only when the callback references the locked digest', async () => {
    const session = {
      providerTransactionId: 'sca-1',
      artifactHash: 'a'.repeat(64),
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 60_000),
    }
    const repository = {
      findOne: jest.fn().mockResolvedValue(session),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const service = new SmartCaSigningService(
      {} as never,
      repository as never,
      {} as never
    )

    await expect(
      service.reconcile('sca-1', 'signed', {
        artifactHash: 'a'.repeat(64),
        certificateSerial: 'cert-1',
        certificateSubject: 'CN=Tenant',
        certificateIssuer: 'CN=VNPT',
        signatureHash: 'sig-hash',
        signedAt: '2026-09-23T10:00:00.000Z',
      })
    ).resolves.toEqual(session)
    expect(session).toEqual(
      expect.objectContaining({
        status: 'signed',
        certificateSerial: 'cert-1',
        certificateSubject: 'CN=Tenant',
        certificateIssuer: 'CN=VNPT',
        signatureHash: 'sig-hash',
        signedAt: new Date('2026-09-23T10:00:00.000Z'),
      })
    )

    const wrongDigestSession = {
      ...session,
      status: 'pending' as const,
      verifiedAt: null,
    }
    repository.findOne.mockResolvedValue(wrongDigestSession)
    await expect(
      service.reconcile('sca-1', 'signed', {
        artifactHash: 'b'.repeat(64),
        certificateSerial: 'cert-2',
      })
    ).rejects.toThrow('SMARTCA_SIGNATURE_DIGEST_MISMATCH')
    expect(wrongDigestSession.status).toBe('pending')
  })

  it('projects a signed SmartCA session into the contract activation gate', async () => {
    const session = {
      contractId,
      signerId: 'tenant-1',
      signerRole: 'tenant' as const,
      providerTransactionId: 'sca-project-1',
      artifactHash: 'a'.repeat(64),
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 60_000),
    }
    const repository = {
      findOne: jest.fn().mockResolvedValue(session),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const contractsService = {
      recordSmartCaSignature: jest
        .fn()
        .mockResolvedValue({ status: 'awaiting-signature' }),
    }
    const service = new SmartCaSigningService(
      {} as never,
      repository as never,
      {} as never,
      contractsService as never
    )

    await service.reconcile('sca-project-1', 'signed', {
      artifactHash: 'a'.repeat(64),
      certificateSerial: 'cert-project-1',
      certificateSubject: 'CN=Tenant',
      certificateIssuer: 'CN=VNPT',
      signatureHash: 'signature-project-1',
      signedAt: '2030-01-01T00:00:00.000Z',
    })

    expect(contractsService.recordSmartCaSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId,
        signerId: 'tenant-1',
        role: 'tenant',
        providerTransactionId: 'sca-project-1',
        certificateSerial: 'cert-project-1',
        artifactHash: 'a'.repeat(64),
      })
    )
  })

  it('cancels a pending session for its signer and leaves terminal sessions unchanged', async () => {
    const session = {
      _id: new ObjectId(),
      contractId,
      signerId: 'tenant-1',
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 60_000),
    }
    const repository = {
      findOne: jest.fn().mockResolvedValue(session),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const service = new SmartCaSigningService(
      {} as never,
      repository as never,
      {} as never
    )

    await expect(
      service.cancelSession(
        contractId,
        session._id.toHexString(),
        'tenant-1',
        false
      )
    ).resolves.toEqual(session)
    expect(session).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        providerStatus: 'cancelled',
      })
    )
  })

  it('makes duplicate and out-of-order callbacks idempotent', async () => {
    const signed = {
      providerTransactionId: 'sca-1',
      artifactHash: 'a'.repeat(64),
      status: 'signed' as const,
      certificateSerial: 'cert-1',
      expiresAt: new Date(Date.now() + 60_000),
    }
    const repository = {
      findOne: jest.fn().mockResolvedValue(signed),
      save: jest.fn(),
    }
    const service = new SmartCaSigningService(
      {} as never,
      repository as never,
      {} as never
    )

    await expect(
      service.reconcile('sca-1', 'signed', {
        artifactHash: 'b'.repeat(64),
        certificateSerial: 'different-cert',
      })
    ).resolves.toBe(signed)
    await expect(
      service.reconcile('sca-1', 'rejected', {
        artifactHash: 'b'.repeat(64),
      })
    ).resolves.toBe(signed)
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('expires a session when a callback arrives after its signing window', async () => {
    const expired = {
      providerTransactionId: 'sca-expired',
      artifactHash: 'a'.repeat(64),
      status: 'pending' as const,
      expiresAt: new Date(Date.now() - 1),
    }
    const repository = {
      findOne: jest.fn().mockResolvedValue(expired),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const service = new SmartCaSigningService(
      {} as never,
      repository as never,
      {} as never
    )

    await expect(
      service.reconcile('sca-expired', 'signed', {
        artifactHash: 'a'.repeat(64),
        certificateSerial: 'cert-expired',
      })
    ).resolves.toBe(expired)
    expect(expired).toEqual(
      expect.objectContaining({ status: 'expired', providerStatus: 'expired' })
    )
  })
})
