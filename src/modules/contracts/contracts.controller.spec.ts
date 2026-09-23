import { BadRequestException } from '@nestjs/common'
import { ContractsController } from './contracts.controller'
import type { ContractsService } from './contracts.service'
import type { ContractArtifactService } from './contract-artifact.service'
import type { ContractViewService } from './contract-view.service'
import type { LedgerAuditQueryService } from '../fabric/ledger-audit-query.service'
import type { SmartOtpService } from '../smart-otp/services/smart-otp.service'
import type { SmartCaSigningService } from './smartca/smartca-signing.service'

describe('ContractsController', () => {
  const service = {
    signContractForUser: jest.fn(),
    issueSigningGrant: jest.fn(),
    verifySignerForUser: jest.fn(),
    saveContractContent: jest.fn(),
    lockContractContent: jest.fn(),
    terminateContract: jest.fn(),
    findOne: jest.fn(),
    findOneForUser: jest.fn(),
    getPublicServiceChecklistForUser: jest.fn(),
    findByUser: jest.fn(),
    verifyIntegrityForUser: jest.fn(),
  }
  const artifactService = {
    generateDocument: jest.fn(),
    lockCanonicalArtifact: jest.fn(),
  }
  const contractViewService = {
    getForActor: jest.fn(),
  }
  const ledgerAuditQueryService = {
    getContractEvents: jest.fn(),
  }
  const smartOtpService = {
    initiateOtpSession: jest.fn(),
    verifyOtpSignature: jest.fn(),
  }
  const smartCaSigningService = {
    createSession: jest.fn(),
    getSession: jest.fn(),
  }
  const controller = new ContractsController(
    service as unknown as ContractsService,
    artifactService as unknown as ContractArtifactService,
    contractViewService as unknown as ContractViewService,
    ledgerAuditQueryService as unknown as LedgerAuditQueryService,
    smartOtpService as unknown as SmartOtpService,
    smartCaSigningService as unknown as SmartCaSigningService
  )

  beforeEach(() => jest.clearAllMocks())

  it('passes JWT identity and one-time grant instead of a caller role', async () => {
    service.signContractForUser.mockResolvedValue({ status: 'active' })
    await controller.sign('contract-1', { signingGrantId: 'sg_1' }, 'tenant-1')
    expect(service.signContractForUser).toHaveBeenCalledWith(
      'contract-1',
      'tenant-1',
      'sg_1'
    )
  })

  it('scopes contract reads and integrity verification to JWT identity', async () => {
    service.findOneForUser.mockResolvedValue({ status: 'active' })
    service.verifyIntegrityForUser.mockResolvedValue({ isValid: true })
    await controller.findOne('contract-1', {
      _id: 'tenant-1',
      roles: ['tenant'],
    })
    await controller.verify('contract-1', {
      _id: 'tenant-1',
      roles: ['tenant'],
    })

    expect(service.findOneForUser).toHaveBeenCalledWith(
      'contract-1',
      'tenant-1',
      false
    )
    expect(service.verifyIntegrityForUser).toHaveBeenCalledWith(
      'contract-1',
      'tenant-1',
      false
    )
  })

  it('passes the requested public-service purpose and JWT scope', async () => {
    service.getPublicServiceChecklistForUser.mockResolvedValue({
      purpose: 'temporary-residence',
      externalProcedureCompleted: false,
    })

    await controller.publicServiceChecklist(
      'contract-1',
      'temporary-residence',
      {
        _id: 'tenant-1',
        roles: ['tenant'],
      }
    )

    expect(service.getPublicServiceChecklistForUser).toHaveBeenCalledWith(
      'contract-1',
      'tenant-1',
      false,
      'temporary-residence'
    )
  })

  it('lets staff choose a requested user scope while participant requests cannot override identity', async () => {
    await controller.findByUser('tenant-2', {
      _id: 'staff-1',
      roles: ['staff'],
    })
    await controller.findByUser('tenant-2', {
      _id: 'tenant-1',
      roles: ['tenant'],
    })

    expect(service.findByUser).toHaveBeenNthCalledWith(1, 'tenant-2')
    expect(service.findByUser).toHaveBeenNthCalledWith(2, 'tenant-1')
  })

  it('requires selfie input for signer verification', async () => {
    await expect(
      controller.verifySigner('contract-1', 'tenant-1', undefined)
    ).rejects.toThrow(BadRequestException)
  })

  it('passes staff ownership context when saving contract content', async () => {
    service.saveContractContent.mockResolvedValue({ contentRevision: 1 })
    await controller.saveContent(
      'contract-1',
      { content: { type: 'doc' }, expectedRevision: 0 },
      { _id: 'staff-1', roles: ['staff'] }
    )

    expect(service.saveContractContent).toHaveBeenCalledWith(
      'contract-1',
      'staff-1',
      { type: 'doc' },
      0,
      true
    )
  })

  it('locks content through authorized route for staff or landlord', async () => {
    service.lockContractContent.mockResolvedValue({
      status: 'awaiting-signature',
    })
    await controller.lockContent(
      'contract-1',
      { expectedRevision: 1 },
      { _id: 'staff-1', roles: ['staff'] }
    )

    expect(service.lockContractContent).toHaveBeenCalledWith(
      'contract-1',
      'staff-1',
      1,
      true
    )
  })

  it('passes termination reason and idempotency key from staff route', async () => {
    service.terminateContract.mockResolvedValue({ status: 'terminated' })
    await controller.terminate(
      'contract-1',
      {
        reasonCode: 'LANDLORD_REQUEST',
        reason: 'Agreement',
        idempotencyKey: 'term-1',
      },
      'staff-1'
    )

    expect(service.terminateContract).toHaveBeenCalledWith(
      'contract-1',
      'staff-1',
      'LANDLORD_REQUEST',
      'Agreement',
      'term-1'
    )
  })

  it('passes participant identity and staff scope to artifact generation', async () => {
    artifactService.generateDocument.mockResolvedValue(Buffer.from('artifact'))
    await controller.downloadArtifact('contract-1', 'docx', {
      _id: 'tenant-1',
      roles: ['tenant'],
    })

    expect(artifactService.generateDocument).toHaveBeenCalledWith(
      'contract-1',
      'tenant-1',
      false,
      'docx'
    )
  })

  it('requires a canonical PDF upload for the staff artifact-lock route', async () => {
    expect(() =>
      controller.lockCanonicalArtifact(
        'contract-1',
        { _id: 'staff-1', roles: ['staff'] },
        undefined
      )
    ).toThrow('CONTRACT_ARTIFACT_BYTES_MISSING')

    artifactService.lockCanonicalArtifact.mockResolvedValue({
      artifactHash: 'a'.repeat(64),
    })
    const result = await controller.lockCanonicalArtifact(
      'contract-1',
      { _id: 'staff-1', roles: ['staff'] },
      { buffer: Buffer.from('%PDF-1.7\nbytes') } as Express.Multer.File
    )
    expect(artifactService.lockCanonicalArtifact).toHaveBeenCalledWith(
      'contract-1',
      'staff-1',
      true,
      Buffer.from('%PDF-1.7\nbytes')
    )
    expect(result.artifactHash).toHaveLength(64)
  })

  it('delegates contract view to ContractViewService', async () => {
    contractViewService.getForActor.mockResolvedValue({
      contract: { code: 'HD-001' },
    })
    const result = await controller.getContractView('contract-1', {
      _id: 'tenant-1',
      roles: ['tenant'],
    })
    expect(contractViewService.getForActor).toHaveBeenCalledWith(
      'contract-1',
      'tenant-1',
      false
    )
    expect(result.contract.code).toBe('HD-001')
  })

  it('verifies actor access before returning contract audit events', async () => {
    service.findOneForUser.mockResolvedValue({ _id: 'contract-1' })
    ledgerAuditQueryService.getContractEvents.mockResolvedValue([
      { eventType: 'contract.activated', txId: 'tx-1' },
    ])
    const result = await controller.getContractAuditEvents('contract-1', {
      _id: 'tenant-1',
      roles: ['tenant'],
    })
    expect(service.findOneForUser).toHaveBeenCalledWith(
      'contract-1',
      'tenant-1',
      false
    )
    expect(ledgerAuditQueryService.getContractEvents).toHaveBeenCalledWith(
      'contract-1'
    )
    expect(result).toHaveLength(1)
  })

  it('initiates Smart OTP challenge for locked contract', async () => {
    service.findOne.mockResolvedValue({
      _id: 'contract-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      contentLockedHash: 'hash-abc',
    })
    smartOtpService.initiateOtpSession.mockResolvedValue({
      sessionId: 'sess-1',
      challenge: 'chal-1',
      expiredAt: new Date(),
    })

    const result = await controller.initiateSigningOtp(
      'contract-1',
      'tenant-1',
      'web-device-1'
    )
    expect(smartOtpService.initiateOtpSession).toHaveBeenCalledWith(
      'tenant-1',
      'web-device-1',
      'CONTRACT_SIGN',
      {
        contractId: 'contract-1',
        signerRole: 'tenant',
        contentLockedHash: 'hash-abc',
      }
    )
    expect(result.sessionId).toBe('sess-1')
  })

  it('verifies Smart OTP signature', async () => {
    smartOtpService.verifyOtpSignature.mockResolvedValue({
      success: true,
      message: 'OTP verified',
    })
    const result = await controller.verifySigningOtp('contract-1', 'tenant-1', {
      sessionId: 'sess-1',
      otpCode: '123456',
    })
    expect(smartOtpService.verifyOtpSignature).toHaveBeenCalledWith(
      'tenant-1',
      'sess-1',
      '123456',
      'WEB_SIMULATED_SIG'
    )
    expect(result.success).toBe(true)
  })
})
