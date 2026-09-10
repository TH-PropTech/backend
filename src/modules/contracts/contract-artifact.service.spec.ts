import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { ContractArtifactService } from './contract-artifact.service'
import type { Contract } from './schemas/contract.schema'

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
})
