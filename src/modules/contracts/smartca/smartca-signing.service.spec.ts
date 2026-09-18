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
    executionPolicySnapshot: null as RentalExecutionPolicyRef | null,
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
})
