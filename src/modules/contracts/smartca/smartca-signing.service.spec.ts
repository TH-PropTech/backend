import { ConflictException, ForbiddenException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { SmartCaSigningService } from './smartca-signing.service'

describe('SmartCaSigningService', () => {
  const contractId = new ObjectId().toHexString()
  const contract = {
    _id: new ObjectId(contractId),
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    status: 'awaiting-signature',
    contentLockedHash: 'a'.repeat(64),
  }
  function context(contractValue = contract): {
    service: SmartCaSigningService
    provider: { requestSignature: jest.Mock }
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
    return {
      service: new SmartCaSigningService(
        contractRepository as never,
        sessionRepository as never,
        provider as never
      ),
      provider,
      sessionRepository,
    }
  }

  it('creates a participant-bound pending session for the locked digest', async () => {
    const { service, provider } = context()
    const result = await service.createSession(contractId, 'tenant-1')
    expect(provider.requestSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactHash: 'a'.repeat(64),
        signerRole: 'tenant',
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        providerTransactionId: 'sca-1',
        signerId: 'tenant-1',
      })
    )
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
})
