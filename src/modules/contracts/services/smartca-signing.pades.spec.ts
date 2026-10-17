import { ObjectId } from 'mongodb'
import { SmartCaSigningService } from './smartca-signing.service'

describe('SmartCaSigningService PAdES integration', () => {
  const contractId = new ObjectId().toHexString()
  const canonicalHash = 'a'.repeat(64)
  const padesDigest = 'd'.repeat(64)
  const documentId = `contract-${contractId}-r1`
  const contract = {
    _id: new ObjectId(contractId),
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    status: 'awaiting-signature',
    contentLockedHash: canonicalHash,
    deposit: 0,
    artifactRef: {
      revision: 1,
      artifactHash: canonicalHash,
      contentType: 'application/pdf',
    },
    executionPolicySnapshot: null,
  }
  const original = process.env['SMARTCA_V2_ENABLED']
  const credentials = { password: 'pw-secret', otp: '654321' }

  beforeEach(() => {
    process.env['SMARTCA_V2_ENABLED'] = 'true'
  })
  afterEach(() => {
    process.env['SMARTCA_V2_ENABLED'] = original
  })

  function build(padesEnabled = true): {
    service: SmartCaSigningService
    provider: Record<string, jest.Mock>
    signedArtifacts: Record<string, jest.Mock>
    contractsService: { recordSmartCaSignature: jest.Mock }
  } {
    const sessionRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: Record<string, unknown>) => ({
        _id: new ObjectId(),
        ...v,
      })),
      save: jest.fn((v: Record<string, unknown>) => Promise.resolve(v)),
      remove: jest.fn().mockResolvedValue(true),
    }
    const provider = {
      listCertificates: jest.fn().mockResolvedValue([
        {
          serialNumber: 'SERIAL-001',
          isValid: true,
          subject: 'CN=T',
          issuer: 'CN=I',
        },
      ]),
      getCertificateMaterial: jest
        .fn()
        .mockResolvedValue({ signerPem: 'PEM', chainPem: ['CA'] }),
      signV2: jest
        .fn()
        .mockResolvedValue({ transactionId: 'vnpt-1', sad: 'sad' }),
      confirmV2: jest.fn().mockResolvedValue({
        documentId,
        signatureValue: 'c2ln',
        signedAt: '2026-10-11T00:00:00.000Z',
      }),
    }
    const signedArtifacts = {
      isEnabled: jest.fn().mockReturnValue(padesEnabled),
      prepare: jest.fn().mockResolvedValue({
        id: 'signed-1',
        signedAttrsDigest: padesDigest,
      }),
      attachSession: jest.fn().mockResolvedValue(undefined),
      finalize: jest.fn().mockResolvedValue(true),
      markFailed: jest.fn().mockResolvedValue(undefined),
    }
    const contractsService = {
      recordSmartCaSignature: jest.fn().mockResolvedValue({}),
    }
    const service = new SmartCaSigningService(
      { findOne: jest.fn().mockResolvedValue(contract) } as never,
      sessionRepository as never,
      {
        findByUserId: jest.fn().mockResolvedValue({
          status: 'verified',
          idCardNumber: '000000000001',
        }),
      } as never,
      provider as never,
      contractsService as never,
      undefined,
      undefined,
      undefined,
      signedArtifacts as never
    )
    return { service, provider, signedArtifacts, contractsService }
  }

  it('signs the PAdES digest instead of the canonical hash and embeds the signature', async () => {
    const { service, provider, signedArtifacts, contractsService } = build()

    const session = await service.createSessionV2(
      contractId,
      'tenant-1',
      credentials
    )

    expect(provider.signV2).toHaveBeenCalledWith(
      expect.objectContaining({ artifactHash: padesDigest })
    )
    expect(signedArtifacts.finalize).toHaveBeenCalledWith('signed-1', 'c2ln')
    expect(session.status).toBe('signed')
    // Ledger/gate vẫn ghi hash canonical, không phải digest PAdES.
    expect(contractsService.recordSmartCaSignature).toHaveBeenCalledWith(
      expect.objectContaining({ artifactHash: canonicalHash })
    )
  })

  it('keeps the canonical hash flow when PAdES is disabled', async () => {
    const { service, provider, signedArtifacts } = build(false)

    await service.createSessionV2(contractId, 'tenant-1', credentials)

    expect(provider.signV2).toHaveBeenCalledWith(
      expect.objectContaining({ artifactHash: canonicalHash })
    )
    expect(signedArtifacts.prepare).not.toHaveBeenCalled()
    expect(signedArtifacts.finalize).not.toHaveBeenCalled()
  })

  it('discards the prepared copy when the provider rejects the signature', async () => {
    const { service, provider, signedArtifacts } = build()
    provider['signV2']?.mockRejectedValue(
      new Error('SMARTCA_CREDENTIAL_REJECTED')
    )

    await expect(
      service.createSessionV2(contractId, 'tenant-1', credentials)
    ).rejects.toThrow('SMARTCA_CREDENTIAL_REJECTED')

    expect(signedArtifacts.markFailed).toHaveBeenCalledWith(
      'signed-1',
      'SMARTCA_REQUEST_REJECTED'
    )
    expect(signedArtifacts.finalize).not.toHaveBeenCalled()
  })

  it('refuses to sign silently without an embedded copy when preparing the PDF fails', async () => {
    const { service, provider, signedArtifacts, contractsService } = build()
    signedArtifacts['prepare']?.mockRejectedValue(new Error('PADES_BROKEN'))

    await expect(
      service.createSessionV2(contractId, 'tenant-1', credentials)
    ).rejects.toThrow('SIGNED_ARTIFACT_PREPARE_FAILED')

    expect(provider.signV2).not.toHaveBeenCalled()
    expect(contractsService.recordSmartCaSignature).not.toHaveBeenCalled()
  })

  it('keeps the session signed when embedding the signature fails', async () => {
    const { service, signedArtifacts } = build()
    signedArtifacts['finalize']?.mockResolvedValue(false)

    const session = await service.createSessionV2(
      contractId,
      'tenant-1',
      credentials
    )

    expect(session.status).toBe('signed')
  })
})
