import { BadRequestException } from '@nestjs/common'
import { ContractsController } from './contracts.controller'
import type { ContractsService } from './contracts.service'
import type { ContractArtifactService } from './contract-artifact.service'

describe('ContractsController', () => {
  const service = {
    signContractForUser: jest.fn(),
    issueSigningGrant: jest.fn(),
    verifySignerForUser: jest.fn(),
    saveContractContent: jest.fn(),
    lockContractContent: jest.fn(),
    terminateContract: jest.fn(),
    findOneForUser: jest.fn(),
    findByUser: jest.fn(),
    verifyIntegrityForUser: jest.fn(),
  }
  const artifactService = {
    generateDocument: jest.fn(),
  }
  const controller = new ContractsController(
    service as unknown as ContractsService,
    artifactService as unknown as ContractArtifactService
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

  it('locks content only through the staff/admin route', async () => {
    service.lockContractContent.mockResolvedValue({
      status: 'awaiting-signature',
    })
    await controller.lockContent(
      'contract-1',
      { expectedRevision: 1 },
      'staff-1'
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
})
