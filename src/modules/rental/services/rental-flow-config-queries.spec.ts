import type { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import type { Repository } from 'typeorm'
import { RentalFlowConfigResolver } from './rental-flow-config-resolver.service'
import { RentalFlowAssignmentsService } from './rental-flow-assignments.service'
import { toPolicyView, toProfileView } from '../utils/rental-flow-config.mapper'
import { RentalFlowProfilesService } from './rental-flow-profiles.service'
import { RentalExecutionPoliciesService } from './rental-execution-policies.service'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import { DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS } from '../utils/rental-execution-policy.util'
import { DEFAULT_FLOW_PROFILE_STEPS } from '../utils/default-flow-profile'
import type { RentalFlowConfig } from '../schemas/rental-flow-config.schema'

/**
 * Kiểm bộ lọc `where` của mọi truy vấn profile/policy/assignment (điều kiện survey G-RFC).
 * `KIND_*` là phần phân loại cộng thêm khi các loại dùng chung một collection.
 */
const KIND_PROFILE = { kind: 'profile' }
const KIND_POLICY = { kind: 'policy' }
const KIND_ASSIGNMENT = { kind: 'assignment' }

const past = new Date(Date.now() - 10000)

// Không dùng jest.fn: beforeEach(resetAllMocks) của file này xóa implementation của mock,
// còn save() của TypeORM luôn trả về entity (facade ActivityLog đọc giá trị đó).
function auditService(): ConfigAuditService {
  return new ConfigAuditService({
    create: (v: unknown) => v,
    save: (v: unknown) => Promise.resolve(v),
  } as unknown as Repository<ActivityLog>)
}

describe('RentalFlowConfigResolver where-clauses', () => {
  const configRepo = { findOne: jest.fn() }
  const resolver = new RentalFlowConfigResolver(
    configRepo as unknown as Repository<RentalFlowConfig>
  )

  beforeEach(() => jest.resetAllMocks())

  const assignment = (
    scope: string,
    profileId: string,
    scopeValue: string | null = null
  ): Record<string, unknown> => ({
    scope,
    scopeValue,
    profileRef: { profileId, version: 4, contentHash: 'h' },
    effectiveAt: past,
    assignmentId: `asgn-${scope}`,
  })

  it('queries PACKAGE, DURATION, GLOBAL in order and loads the published profile', async () => {
    configRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(assignment('GLOBAL', 'prof-g'))
      .mockResolvedValueOnce({
        kind: 'profile',
        key: 'prof-g',
        name: 'G',
        version: 4,
        contentHash: 'hg',
        steps: DEFAULT_FLOW_PROFILE_STEPS,
      })

    const result = await resolver.resolve({
      packageId: 'pk',
      durationMonths: 6,
    })

    expect(result.resolvedFrom.scope).toBe('GLOBAL')
    expect(result.resolvedFrom.profileId).toBe('prof-g')
    expect(configRepo.findOne.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      {
        where: {
          ...KIND_ASSIGNMENT,
          scope: 'PACKAGE',
          scopeValue: 'pk',
          supersededAt: null,
        },
      },
      {
        where: {
          ...KIND_ASSIGNMENT,
          scope: 'DURATION',
          scopeValue: '6',
          supersededAt: null,
        },
      },
      {
        where: { ...KIND_ASSIGNMENT, scope: 'GLOBAL', supersededAt: null },
      },
      {
        where: {
          ...KIND_PROFILE,
          key: 'prof-g',
          status: 'published',
          version: 4,
        },
      },
    ])
  })

  it('falls to the lower level when the profile of a PACKAGE assignment is not published', async () => {
    configRepo.findOne
      .mockResolvedValueOnce(assignment('PACKAGE', 'prof-gone', 'pk'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(assignment('DURATION', 'prof-d', '3'))
      .mockResolvedValueOnce({
        kind: 'profile',
        key: 'prof-d',
        name: 'D',
        version: 4,
        contentHash: 'hd',
        steps: DEFAULT_FLOW_PROFILE_STEPS,
      })

    const result = await resolver.resolve({
      packageId: 'pk',
      durationMonths: 3,
    })

    expect(result.resolvedFrom.scope).toBe('DURATION')
    expect(configRepo.findOne.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      {
        where: {
          ...KIND_ASSIGNMENT,
          scope: 'PACKAGE',
          scopeValue: 'pk',
          supersededAt: null,
        },
      },
      {
        where: {
          ...KIND_PROFILE,
          key: 'prof-gone',
          status: 'published',
          version: 4,
        },
      },
      {
        where: {
          ...KIND_ASSIGNMENT,
          scope: 'DURATION',
          scopeValue: '3',
          supersededAt: null,
        },
      },
      {
        where: {
          ...KIND_PROFILE,
          key: 'prof-d',
          status: 'published',
          version: 4,
        },
      },
    ])
  })

  it('uses the system fallback when every profile lookup is empty', async () => {
    configRepo.findOne.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          where.kind === 'assignment' ? assignment('GLOBAL', 'x') : null
        )
    )

    const result = await resolver.resolve({})

    expect(result.resolvedFrom.scope).toBe('SYSTEM_FALLBACK')
  })
})

describe('RentalFlowProfilesService where-clauses', () => {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
  }
  const service = new RentalFlowProfilesService(
    repo as unknown as Repository<RentalFlowConfig>,
    auditService()
  )

  beforeEach(() => {
    jest.resetAllMocks()
    repo.create.mockImplementation((v: unknown) => v)
    repo.save.mockImplementation((v: unknown) => Promise.resolve(v))
  })

  it('listProfiles scans only profiles ordered by createdAt DESC', async () => {
    repo.find.mockResolvedValue([])
    await service.listProfiles()
    expect(repo.find).toHaveBeenCalledWith({
      ...(Object.keys(KIND_PROFILE).length ? { where: KIND_PROFILE } : {}),
      order: { createdAt: 'DESC' },
    })
  })

  it('getProfile reads the draft and the published versions of one profileId', async () => {
    repo.findOne.mockResolvedValue({ key: 'p1', status: 'draft' })
    repo.find.mockResolvedValue([])
    await service.getProfile('p1')
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { ...KIND_PROFILE, key: 'p1', status: 'draft' },
    })
    expect(repo.find).toHaveBeenCalledWith({
      where: { ...KIND_PROFILE, key: 'p1', status: 'published' },
      order: { version: 'DESC' },
    })
  })

  it('getPublishedProfile and the seed check filter published + version', async () => {
    repo.findOne.mockResolvedValue(null)
    await service.getPublishedProfile('p1', 2)
    expect(repo.findOne).toHaveBeenCalledWith({
      where: {
        ...KIND_PROFILE,
        key: 'p1',
        status: 'published',
        version: 2,
      },
    })
    await service.ensureSeedProfile()
    expect(repo.findOne).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        ...KIND_PROFILE,
        status: 'published',
        version: 1,
      }) as unknown,
    })
  })

  it('publish reads the draft then the latest published version of that profileId', async () => {
    repo.findOne
      .mockResolvedValueOnce({
        key: 'p1',
        status: 'draft',
        draftRevision: 1,
        name: 'n',
        description: 'd',
        schemaVersion: 1,
        changeClassification: 'PRESENTATION',
        steps: DEFAULT_FLOW_PROFILE_STEPS,
      })
      .mockResolvedValueOnce(null)
    await service.publish('p1', { expectedRevision: 1 }, 'a')
    expect(repo.findOne.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      { where: { ...KIND_PROFILE, key: 'p1', status: 'draft' } },
      {
        where: { ...KIND_PROFILE, key: 'p1', status: 'published' },
        order: { version: 'DESC' },
      },
    ])
  })
})

describe('RentalExecutionPoliciesService where-clauses', () => {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
  }
  const service = new RentalExecutionPoliciesService(
    repo as unknown as Repository<RentalFlowConfig>,
    auditService()
  )

  beforeEach(() => {
    jest.resetAllMocks()
    repo.create.mockImplementation((v: unknown) => v)
    repo.save.mockImplementation((v: unknown) => Promise.resolve(v))
  })

  it('listActive only returns published policies, never profiles', async () => {
    repo.find.mockResolvedValue([])
    await service.listActive()
    expect(repo.find).toHaveBeenCalledWith({
      where: { ...KIND_POLICY, status: 'published' },
      order: { key: 'ASC', version: 'DESC' },
    })
  })

  it('listAll scans only policies ordered by createdAt DESC', async () => {
    repo.find.mockResolvedValue([])
    await service.listAll()
    expect(repo.find).toHaveBeenCalledWith({
      ...(Object.keys(KIND_POLICY).length ? { where: KIND_POLICY } : {}),
      order: { createdAt: 'DESC' },
    })
  })

  it('archive and resolvePublishedRef look up published policyId + version', async () => {
    repo.findOne.mockResolvedValue(null)
    await expect(service.archive('pol', 2, 'a', 'r')).rejects.toThrow()
    expect(repo.findOne).toHaveBeenCalledWith({
      where: {
        ...KIND_POLICY,
        key: 'pol',
        status: 'published',
        version: 2,
      },
    })
    await expect(
      service.resolvePublishedRef({
        policyId: 'pol',
        version: 2,
        strategy: 'SIGN_FIRST',
        contentHash: 'h',
      })
    ).rejects.toThrow()
    expect(repo.findOne).toHaveBeenLastCalledWith({
      where: {
        ...KIND_POLICY,
        key: 'pol',
        status: 'published',
        version: 2,
      },
    })
  })

  it('publish reads the draft then the latest published version of that policyId', async () => {
    repo.findOne
      .mockResolvedValueOnce({
        key: 'pol',
        status: 'draft',
        draftRevision: 1,
        strategy: 'SIGN_FIRST',
        name: 'n',
        description: 'd',
        disclosure: DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS[0].disclosure,
      })
      .mockResolvedValueOnce(null)
    await service.publish('pol', { expectedRevision: 1, reason: 'r' }, 'a')
    expect(repo.findOne.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      { where: { ...KIND_POLICY, key: 'pol', status: 'draft' } },
      {
        where: { ...KIND_POLICY, key: 'pol', status: 'published' },
        order: { version: 'DESC' },
      },
    ])
  })
})

describe('RentalFlowConfig views (API shape unchanged)', () => {
  const createdAt = new Date(Date.UTC(2026, 0, 1))
  const base = {
    _id: 'oid-1',
    status: 'published',
    version: 2,
    draftRevision: 1,
    contentHash: 'h',
    name: 'N',
    description: 'D',
    createdAt,
    updatedAt: createdAt,
  }

  it('profile view exposes profileId and hides kind, key and policy-only fields', () => {
    const view = toProfileView({
      ...base,
      kind: 'profile',
      key: 'prof-1',
      schemaVersion: 1,
      changeClassification: 'PRESENTATION',
      steps: DEFAULT_FLOW_PROFILE_STEPS,
      strategy: 'SIGN_FIRST',
    } as unknown as RentalFlowConfig)

    expect(view).toMatchObject({ profileId: 'prof-1', version: 2 })
    expect(Object.keys(view)).not.toEqual(
      expect.arrayContaining(['kind', 'key', 'strategy', 'archivedAt'])
    )
  })

  it('policy view exposes policyId and hides kind, key and profile-only fields', () => {
    const view = toPolicyView({
      ...base,
      kind: 'policy',
      key: 'sign-first',
      strategy: 'SIGN_FIRST',
      disclosure: {},
      steps: DEFAULT_FLOW_PROFILE_STEPS,
    } as unknown as RentalFlowConfig)

    expect(view).toMatchObject({
      policyId: 'sign-first',
      strategy: 'SIGN_FIRST',
    })
    expect(Object.keys(view)).not.toEqual(
      expect.arrayContaining(['kind', 'key', 'steps', 'changeClassification'])
    )
  })
})

describe('RentalFlowAssignmentsService profile lookups', () => {
  it('only reads published rows of kind profile when activating', async () => {
    const configRepo = { findOne: jest.fn().mockResolvedValue(null) }
    const service = new RentalFlowAssignmentsService(
      configRepo as unknown as Repository<RentalFlowConfig>,
      auditService()
    )

    await expect(
      service.activateAssignment(
        { scope: 'GLOBAL', profileId: 'prof-x', version: 3 } as never,
        'admin'
      )
    ).rejects.toThrow()

    expect(configRepo.findOne).toHaveBeenCalledWith({
      where: {
        kind: 'profile',
        key: 'prof-x',
        status: 'published',
        version: 3,
      },
    })
  })
})
