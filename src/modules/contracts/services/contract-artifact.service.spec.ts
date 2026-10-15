import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { ContractArtifactService } from './contract-artifact.service'
import type { Contract } from '../schemas/contract.schema'
import type { ContractDocument } from '../schemas/contract-document.schema'
import type { ContractArtifactStorage } from './contract-artifact.storage'

describe('ContractArtifactService', () => {
  function createService(): {
    service: ContractArtifactService
    contract: Contract
  } {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      contentLockedHash: 'a'.repeat(64),
      contentLockedAt: new Date(),
    } as unknown as Contract
    const repository = {
      findOne: jest.fn().mockResolvedValue(contract),
    }
    return {
      service: new ContractArtifactService(
        repository as unknown as Repository<Contract>
      ),
      contract,
    }
  }

  it('fails closed until an approved renderer is configured', async () => {
    const { service, contract } = createService()
    await expect(
      service.generateDocument(
        contract._id.toHexString(),
        'tenant-1',
        false,
        'pdf'
      )
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('rejects non-participants and unlocked contracts before renderer access', async () => {
    const { service, contract } = createService()
    await expect(
      service.generateDocument(
        contract._id.toHexString(),
        'outsider',
        false,
        'pdf'
      )
    ).rejects.toBeInstanceOf(ForbiddenException)
    contract.contentLockedAt = null
    await expect(
      service.generateDocument(
        contract._id.toHexString(),
        'tenant-1',
        false,
        'pdf'
      )
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects formats outside the approved PDF/DOCX contract', async () => {
    const { service, contract } = createService()
    await expect(
      service.generateDocument(
        contract._id.toHexString(),
        'staff-1',
        true,
        'html'
      )
    ).rejects.toThrow('CONTRACT_ARTIFACT_FORMAT_INVALID')
  })

  it('locks exact PDF bytes in GridFS metadata and streams the same bytes', async () => {
    const bytes = Buffer.from('%PDF-1.7\ncanonical contract bytes')
    const artifactHash = createHash('sha256').update(bytes).digest('hex')
    const artifactId = new ObjectId()
    const contract = {
      _id: new ObjectId(),
      contractCode: 'CT-001',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      contentLockedHash: artifactHash,
      contentLockedAt: new Date(),
      contentRevision: 2,
      termsRef: { key: 'lease-vn', version: 4, contentHash: 'template-hash' },
      flowProfileRef: {
        profileId: 'PRIVATE_CIVIL_APARTMENT_LEASE',
        version: 1,
        hash: 'flow-hash',
      },
      hashSchemaVersion: 2,
    } as unknown as Contract
    const savedArtifact = {
      _id: artifactId,
      contractId: contract._id.toHexString(),
      revision: 2,
      templateRef: contract.termsRef,
      legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
      gridFsFileId: new ObjectId(),
      artifactHash,
      byteLength: bytes.length,
      contentType: 'application/pdf' as const,
      lockedAt: contract.contentLockedAt,
    } as unknown as ContractDocument
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn().mockResolvedValue(contract),
    }
    const artifactRepository = {
      findOne: jest.fn().mockResolvedValue(savedArtifact),
      create: jest.fn().mockReturnValue(savedArtifact),
      save: jest.fn().mockResolvedValue(savedArtifact),
    }
    const uploadMock = jest.fn().mockResolvedValue(savedArtifact.gridFsFileId)
    const downloadMock = jest.fn().mockResolvedValue(bytes)
    const storage: ContractArtifactStorage = {
      upload: uploadMock,
      download: downloadMock,
    }
    const service = new ContractArtifactService(
      contractRepository as never,
      artifactRepository as never,
      storage
    )

    const locked = await service.lockCanonicalArtifact(
      contract._id.toHexString(),
      'staff-1',
      true,
      bytes
    )
    expect(locked).toEqual(savedArtifact)
    expect(uploadMock).toHaveBeenCalledWith(bytes, 'CT-001-r2.pdf')
    expect(artifactRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'canonical' })
    )
    expect(locked).not.toHaveProperty('kind')
    expect(contract.artifactRef).toEqual(
      expect.objectContaining({
        artifactId: artifactId.toHexString(),
        artifactHash,
        templateKey: 'lease-vn',
        templateVersion: 4,
      })
    )
    expect(contract.contractHash).toBe(artifactHash)

    await expect(
      service.lockCanonicalArtifact(
        contract._id.toHexString(),
        'staff-1',
        true,
        bytes
      )
    ).resolves.toEqual(savedArtifact)
    expect(uploadMock).toHaveBeenCalledTimes(1)

    contract.artifactRef = {
      artifactId: artifactId.toHexString(),
      revision: 2,
      templateKey: 'lease-vn',
      templateVersion: 4,
      hashSchemaVersion: 2,
      artifactHash,
      contentType: 'application/pdf',
      lockedAt: contract.contentLockedAt as Date,
    }
    await expect(
      service.generateDocument(
        contract._id.toHexString(),
        'tenant-1',
        false,
        'pdf'
      )
    ).resolves.toEqual(bytes)

    await expect(service.resolveCanonicalArtifact(contract)).resolves.toEqual(
      expect.objectContaining({
        artifact: savedArtifact,
        bytes,
        reference: contract.artifactRef,
      })
    )

    expect(artifactRepository.findOne).toHaveBeenCalledWith({
      where: { _id: artifactId, kind: 'canonical' },
    })
    savedArtifact.revision = 3
    await expect(service.resolveCanonicalArtifact(contract)).rejects.toThrow(
      'CONTRACT_ARTIFACT_SUPERSEDED'
    )
    savedArtifact.revision = 2
    downloadMock.mockResolvedValueOnce(Buffer.from('%PDF-1.7\ntampered'))
    await expect(service.resolveCanonicalArtifact(contract)).rejects.toThrow(
      'CONTRACT_ARTIFACT_HASH_MISMATCH'
    )
  })

  it('rejects replacement, non-PDF bytes, and digest mismatch without storage writes', async () => {
    const bytes = Buffer.from('%PDF-1.7\nnew bytes')
    const contract = {
      _id: new ObjectId(),
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      contentLockedHash: 'a'.repeat(64),
      contentLockedAt: new Date(),
    } as unknown as Contract
    const uploadMock = jest.fn()
    const storage: ContractArtifactStorage = {
      upload: uploadMock,
      download: jest.fn(),
    }
    const artifactRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    }
    const service = new ContractArtifactService(
      { findOne: jest.fn().mockResolvedValue(contract) } as never,
      artifactRepository as never,
      storage
    )

    await expect(
      service.lockCanonicalArtifact(
        contract._id.toHexString(),
        'staff-1',
        true,
        Buffer.from('not-a-pdf')
      )
    ).rejects.toThrow('CONTRACT_ARTIFACT_PDF_INVALID')
    await expect(
      service.lockCanonicalArtifact(
        contract._id.toHexString(),
        'staff-1',
        true,
        bytes
      )
    ).rejects.toThrow('CONTRACT_ARTIFACT_HASH_MISMATCH')
    expect(uploadMock).not.toHaveBeenCalled()

    await expect(
      service.lockCanonicalArtifact(
        contract._id.toHexString(),
        'staff-1',
        true,
        Buffer.alloc(0)
      )
    ).rejects.toThrow('CONTRACT_ARTIFACT_BYTES_MISSING')

    const failureBytes = Buffer.from('%PDF-1.7\n' + 'a'.repeat(64))
    const failureContract = {
      ...contract,
      contentLockedHash: createHash('sha256')
        .update(failureBytes)
        .digest('hex'),
      artifactRef: null,
    }
    const uploadFailure = jest.fn().mockRejectedValue(new Error('gridfs down'))
    const uploadFailureService = new ContractArtifactService(
      { findOne: jest.fn().mockResolvedValue(failureContract) } as never,
      artifactRepository as never,
      { upload: uploadFailure, download: jest.fn() }
    )
    await expect(
      uploadFailureService.lockCanonicalArtifact(
        contract._id.toHexString(),
        'staff-1',
        true,
        failureBytes
      )
    ).rejects.toThrow('gridfs down')
  })

  it('locks and resolves amendment artifacts with both byte and canonical hashes', async () => {
    const bytes = Buffer.from('%PDF-1.7\namendment bytes')
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractCode: 'CT-001',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      contractTemplateRef: {
        key: 'VN_INDIVIDUAL_RESIDENTIAL_LEASE',
        version: 2,
        contentHash: 'template-hash',
      },
    } as unknown as Contract
    const amendment = {
      _id: new ObjectId('507f1f77bcf86cd799439012'),
      contractId: contract._id.toHexString(),
      sequence: 1,
      status: 'locked',
      revision: 0,
      contentHash: 'canonical-amendment-hash',
      effectiveFrom: new Date(Date.now() + 86_400_000),
    } as unknown as import('../schemas/contract-amendment.schema').ContractAmendment
    const artifactId = new ObjectId('507f1f77bcf86cd799439013')
    const artifactHash = createHash('sha256').update(bytes).digest('hex')
    const artifact = {
      _id: artifactId,
      contractId: contract._id.toHexString(),
      amendmentId: amendment._id.toHexString(),
      revision: 1,
      artifactHash,
      canonicalContentHash: amendment.contentHash,
      byteLength: bytes.length,
      contentType: 'application/pdf' as const,
      lockedAt: new Date(),
      gridFsFileId: new ObjectId(),
      rendererVersion: 'uploaded-amendment-pdf-v1',
      sourceSchemaVersion: 2,
    } as unknown as ContractDocument
    const amendmentRepository = {
      findOne: jest.fn().mockResolvedValue(amendment),
      save: jest.fn().mockResolvedValue(amendment),
    }
    const artifactRepository = {
      create: jest.fn().mockReturnValue(artifact),
      save: jest.fn().mockResolvedValue(artifact),
      findOne: jest.fn().mockResolvedValue(artifact),
    }
    const storage = {
      upload: jest.fn().mockResolvedValue(artifact.gridFsFileId),
      download: jest.fn().mockResolvedValue(bytes),
    }
    const service = new ContractArtifactService(
      { findOne: jest.fn().mockResolvedValue(contract) } as never,
      artifactRepository as never,
      storage,
      amendmentRepository as never
    )

    const locked = await service.lockAmendmentArtifact(
      contract._id.toHexString(),
      amendment._id.toHexString(),
      'staff-1',
      true,
      bytes
    )

    expect(locked.status).toBe('pending-signature')
    expect(locked.artifactRef).toEqual(
      expect.objectContaining({
        artifactHash,
        canonicalContentHash: amendment.contentHash,
      })
    )
    await expect(
      service.resolveAmendmentArtifact(
        contract._id.toHexString(),
        amendment._id.toHexString(),
        'tenant-1',
        false
      )
    ).resolves.toEqual(
      expect.objectContaining({ bytes, artifactHash, revision: 1 })
    )
  })
})
