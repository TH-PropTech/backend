import { ConflictException } from '@nestjs/common'
import type { Repository } from 'typeorm'
import { RentalExecutionPoliciesService } from './rental-execution-policies.service'
import { RentalExecutionPolicy } from './schemas/rental-execution-policy.schema'
import { RentalFlowAudit } from './schemas/rental-flow-audit.schema'
import {
  DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS,
  computeRentalExecutionPolicyHash,
  getDefaultRentalExecutionPolicyRef,
} from './rental-execution-policy.util'

describe('RentalExecutionPoliciesService', () => {
  const policyRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value: RentalExecutionPolicy) => value),
    save: jest.fn((value: RentalExecutionPolicy) => Promise.resolve(value)),
  }
  const auditRepo = {
    create: jest.fn((value: RentalFlowAudit) => value),
    save: jest.fn((value: RentalFlowAudit) => Promise.resolve(value)),
  }

  const service = new RentalExecutionPoliciesService(
    policyRepo as unknown as Repository<RentalExecutionPolicy>,
    auditRepo as unknown as Repository<RentalFlowAudit>
  )

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('seeds both allowlisted policies when absent', async () => {
    policyRepo.findOne.mockResolvedValue(null)

    await service.onModuleInit()

    expect(policyRepo.save).toHaveBeenCalledTimes(2)
    expect(policyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'deposit-first',
        strategy: 'DEPOSIT_FIRST',
        status: 'published',
      })
    )
    expect(policyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'sign-first',
        strategy: 'SIGN_FIRST',
        status: 'published',
      })
    )
  })

  it('rejects a stale draft revision before publishing', async () => {
    policyRepo.findOne.mockResolvedValue({
      policyId: 'sign-first',
      status: 'draft',
      draftRevision: 2,
    })

    await expect(
      service.publish(
        'sign-first',
        { expectedRevision: 1, reason: 'test' },
        'admin-1'
      )
    ).rejects.toThrow('RENTAL_EXECUTION_POLICY_REVISION_STALE')
    expect(policyRepo.save).not.toHaveBeenCalled()
  })

  it('rejects a reference whose hash or strategy does not match published data', async () => {
    policyRepo.findOne.mockResolvedValue({
      policyId: 'deposit-first',
      version: 1,
      status: 'published',
      strategy: 'DEPOSIT_FIRST',
      contentHash: 'server-hash',
    })

    await expect(
      service.resolvePublishedRef({
        policyId: 'deposit-first',
        version: 1,
        strategy: 'SIGN_FIRST',
        contentHash: 'client-hash',
      })
    ).rejects.toThrow(ConflictException)
  })

  it('normalizes an omitted package policy to deposit-first v1', async () => {
    const ref = getDefaultRentalExecutionPolicyRef()
    policyRepo.findOne.mockResolvedValue({
      policyId: ref.policyId,
      version: ref.version,
      status: 'published',
      strategy: ref.strategy,
      contentHash: ref.contentHash,
    })

    await expect(
      service.validatePackagePolicies(undefined, undefined)
    ).resolves.toEqual({
      allowedExecutionPolicies: [ref],
      defaultExecutionPolicy: ref,
    })
  })

  it('computes a published hash from the immutable draft content', async () => {
    const input = DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS[1]
    const draft = {
      policyId: input.policyId,
      status: 'draft' as const,
      strategy: input.strategy,
      name: input.name,
      description: input.description,
      disclosure: input.disclosure,
      draftRevision: 1,
      createdBy: 'admin-1',
    }
    policyRepo.findOne.mockResolvedValueOnce(draft).mockResolvedValueOnce(null)

    const saved = await service.publish(
      input.policyId,
      { expectedRevision: 1, reason: 'initial' },
      'admin-1'
    )

    expect(saved.contentHash).toBe(
      computeRentalExecutionPolicyHash({ ...input, version: 1 })
    )
  })
})
