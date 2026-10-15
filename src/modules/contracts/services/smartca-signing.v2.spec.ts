import { ForbiddenException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { SmartCaSigningService } from './smartca-signing.service'

describe('SmartCaSigningService v2', () => {
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
    artifactRef: { revision: 1, artifactHash, contentType: 'application/pdf' },
    executionPolicySnapshot: null,
  }
  const certificate = {
    serialNumber: 'SERIAL-001',
    isValid: true,
    subject: 'CN=T',
    issuer: 'CN=I',
  }
  const original = process.env['SMARTCA_V2_ENABLED']
  const credentials = { password: 'pw-secret', otp: '654321' }

  afterEach(() => {
    process.env['SMARTCA_V2_ENABLED'] = original
  })

  function build(providerOverrides: Record<string, jest.Mock> = {}): {
    service: SmartCaSigningService
    sessionRepository: {
      findOne: jest.Mock
      save: jest.Mock
      remove: jest.Mock
    }
    provider: Record<string, jest.Mock>
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
      listCertificates: jest.fn().mockResolvedValue([certificate]),
      signV2: jest
        .fn()
        .mockResolvedValue({ transactionId: 'vnpt-1', sad: 'sad-value' }),
      confirmV2: jest.fn().mockResolvedValue({
        documentId,
        signatureValue: 'sig',
        signedAt: '2026-10-11T00:00:00.000Z',
      }),
      ...providerOverrides,
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
      contractsService as never
    )
    return { service, sessionRepository, provider, contractsService }
  }

  it('rejects when smartca_v2 is disabled without calling the provider', async () => {
    process.env['SMARTCA_V2_ENABLED'] = 'false'
    const { service, provider } = build()
    await expect(
      service.createSessionV2(contractId, 'tenant-1', credentials)
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(provider.signV2).not.toHaveBeenCalled()
  })

  it('signs then confirms with sad and never persists credentials', async () => {
    process.env['SMARTCA_V2_ENABLED'] = 'true'
    const { service, provider, sessionRepository, contractsService } = build()

    const session = await service.createSessionV2(
      contractId,
      'tenant-1',
      credentials
    )

    expect(session.status).toBe('signed')
    expect(provider.confirmV2).toHaveBeenCalledWith(
      expect.objectContaining({ sad: 'sad-value', password: 'pw-secret' })
    )
    expect(contractsService.recordSmartCaSignature).toHaveBeenCalled()
    const persisted = JSON.stringify(sessionRepository.save.mock.calls)
    expect(persisted).not.toContain('pw-secret')
    expect(persisted).not.toContain('654321')
    expect(persisted).not.toContain('sad-value')
  })

  it('does not confirm when sign is rejected and leaves no pending session', async () => {
    process.env['SMARTCA_V2_ENABLED'] = 'true'
    const { service, provider, sessionRepository } = build({
      signV2: jest
        .fn()
        .mockRejectedValue(new Error('SMARTCA_CREDENTIAL_REJECTED')),
    })
    await expect(
      service.createSessionV2(contractId, 'tenant-1', credentials)
    ).rejects.toThrow('SMARTCA_CREDENTIAL_REJECTED')
    expect(provider.confirmV2).not.toHaveBeenCalled()
    expect(sessionRepository.remove).toHaveBeenCalled()
  })

  it('marks the session rejected when confirm fails so the signer can retry', async () => {
    process.env['SMARTCA_V2_ENABLED'] = 'true'
    const { service, sessionRepository } = build({
      confirmV2: jest
        .fn()
        .mockRejectedValue(new Error('SMARTCA_CONFIRM_FAILED')),
    })
    await expect(
      service.createSessionV2(contractId, 'tenant-1', credentials)
    ).rejects.toThrow('SMARTCA_CONFIRM_FAILED')
    expect(sessionRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'rejected' })
    )
  })

  it('returns the existing signed session instead of calling the provider again', async () => {
    process.env['SMARTCA_V2_ENABLED'] = 'true'
    const { service, provider, sessionRepository } = build()
    sessionRepository.findOne.mockResolvedValue({ status: 'signed' })
    await expect(
      service.createSessionV2(contractId, 'tenant-1', credentials)
    ).resolves.toEqual({ status: 'signed' })
    expect(provider.signV2).not.toHaveBeenCalled()
  })

  it('lists configured signing methods with availability and no secrets', async () => {
    process.env['SMARTCA_V2_ENABLED'] = 'true'
    const { service } = build()

    const methods = await service.listSigningMethods(contractId, 'tenant-1')

    expect(methods.map(method => method.id)).toEqual(
      expect.arrayContaining(['smartca_v1', 'smartca_v2'])
    )
    const v2 = methods.find(method => method.id === 'smartca_v2')
    expect(v2).toMatchObject({
      available: true,
      inputs: ['smartCaPassword', 'smartCaOtp'],
    })
    expect(JSON.stringify(methods)).not.toContain('000000000001')
  })

  it('marks real signing methods unavailable when the signer has no verified KYC', async () => {
    process.env['SMARTCA_V2_ENABLED'] = 'true'
    const { service } = build()
    const kyc = (
      service as unknown as { kycService: { findByUserId: jest.Mock } }
    ).kycService
    kyc.findByUserId.mockResolvedValue(null)

    const methods = await service.listSigningMethods(contractId, 'tenant-1')

    const v1 = methods.find(method => method.id === 'smartca_v1')
    expect(v1).toMatchObject({
      available: false,
      reason: 'SMARTCA_KYC_REQUIRED',
    })
  })

  it('does not list smartca_v2 when its flag is off', async () => {
    process.env['SMARTCA_V2_ENABLED'] = 'false'
    const { service } = build()
    const methods = await service.listSigningMethods(contractId, 'tenant-1')
    expect(methods.map(method => method.id)).not.toContain('smartca_v2')
  })
})
