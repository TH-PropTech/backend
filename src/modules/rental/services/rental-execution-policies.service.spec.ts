import type { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import { ConflictException } from '@nestjs/common'
import type { Repository } from 'typeorm'
import { RentalExecutionPoliciesService } from './rental-execution-policies.service'
import type { RentalFlowConfig } from '../schemas/rental-flow-config.schema'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import type { ConfigAudit } from '../../activity-log/schemas/config-audit.schema'
import {
  DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS,
  computeRentalExecutionPolicyHash,
  getDefaultRentalExecutionPolicyRef,
} from '../utils/rental-execution-policy.util'

describe('RentalExecutionPoliciesService', () => {
  const policyRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value: RentalFlowConfig) => value),
    save: jest.fn((value: RentalFlowConfig) => Promise.resolve(value)),
  }
  const auditRepo = {
    create: jest.fn((value: ConfigAudit) => value),
    save: jest.fn((value: ConfigAudit) => Promise.resolve(value)),
  }

  const service = new RentalExecutionPoliciesService(
    policyRepo as unknown as Repository<RentalFlowConfig>,
    new ConfigAuditService(auditRepo as unknown as Repository<ActivityLog>)
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
        kind: 'policy',
        key: 'deposit-first',
        strategy: 'DEPOSIT_FIRST',
        status: 'published',
      })
    )
    expect(policyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'policy',
        key: 'sign-first',
        strategy: 'SIGN_FIRST',
        status: 'published',
      })
    )
  })

  it('rejects a stale draft revision before publishing', async () => {
    policyRepo.findOne.mockResolvedValue({
      kind: 'policy',
      key: 'sign-first',
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

  it('appends an audit row when a new draft is saved', async () => {
    policyRepo.findOne.mockResolvedValue(null)

    await service.saveDraft(
      'sign-first',
      {
        strategy: 'SIGN_FIRST',
        name: 'n',
        description: 'd',
        disclosure: 'x',
        expectedRevision: 0,
      } as never,
      'admin-3'
    )

    expect(auditRepo.save).toHaveBeenCalledWith({
      kind: 'config-audit',
      scope: 'rental-flow',
      key: 'sign-first',
      action: 'EXECUTION_POLICY_DRAFT_SAVED',
      actorId: 'admin-3',
      targetType: 'execution-policy',
      version: null,
      details: { draftRevision: 1 },
    })
    expect(auditRepo.save).toHaveBeenCalledTimes(1)
  })

  it('rejects a reference whose hash or strategy does not match published data', async () => {
    policyRepo.findOne.mockResolvedValue({
      kind: 'policy',
      key: 'deposit-first',
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
      kind: 'policy',
      key: ref.policyId,
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
      kind: 'policy',
      key: input.policyId,
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
