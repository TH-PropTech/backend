import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import { ContractsController } from './contracts.controller'
import type { ContractsService } from './contracts.service'
import type { ContractArtifactService } from './contract-artifact.service'
import type { ContractViewService } from './contract-view.service'
import type { LedgerAuditQueryService } from '../fabric/ledger-audit-query.service'
import type { SmartOtpService } from '../smart-otp/services/smart-otp.service'
import type { SmartCaSigningService } from './smartca/smartca-signing.service'
import type { DepositAgreementsService } from './deposit-agreements.service'

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
    generateDocumentWithMetadata: jest.fn(),
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
    listCertificates: jest.fn(),
    createSession: jest.fn(),
    getSession: jest.fn(),
    poll: jest.fn(),
    cancelSession: jest.fn(),
  }
  const depositAgreementsService = {
    createForContract: jest.fn(),
  }
  const controller = new ContractsController(
    service as unknown as ContractsService,
    artifactService as unknown as ContractArtifactService,
    contractViewService as unknown as ContractViewService,
    ledgerAuditQueryService as unknown as LedgerAuditQueryService,
    smartOtpService as unknown as SmartOtpService,
    smartCaSigningService as unknown as SmartCaSigningService,
    depositAgreementsService as unknown as DepositAgreementsService
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

  it('creates a deposit agreement through the staff contract route', async () => {
    depositAgreementsService.createForContract.mockResolvedValue({
      status: 'draft',
    })

    await controller.createDepositAgreement('contract-1')

    expect(depositAgreementsService.createForContract).toHaveBeenCalledWith(
      'contract-1'
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
    artifactService.generateDocumentWithMetadata.mockResolvedValue({
      bytes: Buffer.from('artifact'),
      reference: {},
    })
    await controller.downloadArtifact(
      'contract-1',
      'docx',
      {
        _id: 'tenant-1',
        roles: ['tenant'],
      },
      { setHeader: jest.fn() } as never
    )

    expect(artifactService.generateDocumentWithMetadata).toHaveBeenCalledWith(
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

  it('lists sanitized SmartCA certificates using the JWT participant identity', async () => {
    smartCaSigningService.listCertificates.mockResolvedValue({
      certificates: [
        {
          serialNumber: 'SERIAL-001',
          subject: 'CN=Test Tenant',
          issuer: 'CN=VNPT Test CA',
          validFrom: '2026-01-01T00:00:00.000Z',
          validTo: '2099-01-01T00:00:00.000Z',
          isValid: true,
        },
      ],
    })

    const result = await controller.listSmartCaCertificates(
      'contract-1',
      'tenant-1'
    )

    expect(smartCaSigningService.listCertificates).toHaveBeenCalledWith(
      'contract-1',
      'tenant-1'
    )
    expect(JSON.stringify(result)).not.toContain('idCardNumber')
    expect(JSON.stringify(result)).not.toContain('cert_data')
  })

  it('propagates participant access and certificate business errors without leaking provider data', async () => {
    smartCaSigningService.listCertificates.mockRejectedValueOnce(
      new ForbiddenException('CONTRACT_SIGN_ACCESS_DENIED')
    )
    await expect(
      controller.listSmartCaCertificates('contract-1', 'outsider')
    ).rejects.toThrow('CONTRACT_SIGN_ACCESS_DENIED')

    smartCaSigningService.listCertificates.mockRejectedValueOnce(
      new ConflictException('SMARTCA_CERTIFICATE_INVALID')
    )
    await expect(
      controller.listSmartCaCertificates('contract-1', 'tenant-1')
    ).rejects.toThrow('SMARTCA_CERTIFICATE_INVALID')
  })

  it('creates a SmartCA v2 session without exposing credential or raw signature', async () => {
    smartCaSigningService.createSession.mockResolvedValue({
      _id: { toHexString: () => 'session-1' },
      contractId: 'contract-1',
      signerId: 'tenant-1',
      signerRole: 'tenant',
      artifactHash: 'a'.repeat(64),
      providerTransactionId: 'provider-transaction',
      status: 'signed',
      idempotencyKey: 'request-1',
      certificateSerial: 'SERIAL-001',
      signatureHash: 'signature-hash',
      signatureValueRef: 'raw-signature-must-not-leak',
      expiresAt: new Date('2026-09-23T10:05:00.000Z'),
      createdAt: new Date('2026-09-23T10:00:00.000Z'),
      updatedAt: new Date('2026-09-23T10:00:01.000Z'),
    })
    const dto = {
      idempotencyKey: 'request-1',
      certificateSerial: 'SERIAL-001',
      smartCaPassword: 'password-redacted',
      smartCaOtp: '000000',
    }

    const result = await controller.createSmartCaSigningSession(
      'contract-1',
      'tenant-1',
      dto
    )

    expect(smartCaSigningService.createSession).toHaveBeenCalledWith(
      'contract-1',
      'tenant-1',
      dto
    )
    expect(result).toEqual(
      expect.objectContaining({ id: 'session-1', status: 'signed' })
    )
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(dto.smartCaPassword)
    expect(serialized).not.toContain(dto.smartCaOtp)
    expect(serialized).not.toContain('raw-signature-must-not-leak')
  })
})
