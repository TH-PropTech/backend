import type { Repository } from 'typeorm'
import { RentalFlowConfigResolver } from './rental-flow-config-resolver.service'
import {
  DEFAULT_FLOW_PROFILE_STEPS,
  SAFE_DEFAULT_FLOW_PROFILE_ID,
} from '../utils/default-flow-profile'
import type { RentalFlowConfig } from '../schemas/rental-flow-config.schema'

type Row = Record<string, unknown>

/**
 * Repo giả lọc `where` thật (so sánh bằng; `null` khớp trường null/thiếu như Mongo), để fixture trộn kind
 * kiểm được: một truy vấn thiếu `kind` sẽ khớp nhầm hàng của loại khác.
 */
function repoWith(rows: Row[]): {
  findOne: jest.Mock<Promise<Row | null>, [{ where: Row }]>
} {
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([field, expected]) => {
      if (expected === null) return (row[field] ?? null) === null
      return row[field] === expected
    })
  return {
    findOne: jest.fn(({ where }: { where: Row }) =>
      Promise.resolve(rows.find(row => matches(row, where)) ?? null)
    ),
  }
}

const past = new Date(Date.now() - 10000)

const assignmentRow = (
  scope: string,
  scopeValue: string | null,
  profileId: string,
  assignmentId: string
): Row => ({
  kind: 'assignment',
  key: assignmentId,
  scope,
  scopeValue,
  profileRef: { profileId, version: 4, contentHash: 'h' },
  effectiveAt: past,
  supersededAt: null,
})

const profileRow = (
  key: string,
  name: string,
  steps = DEFAULT_FLOW_PROFILE_STEPS
): Row => ({
  kind: 'profile',
  key,
  name,
  status: 'published',
  version: 4,
  contentHash: `hash-${key}`,
  steps,
})

describe('RentalFlowConfigResolver', () => {
  it('queries PACKAGE, DURATION, GLOBAL assignments in order (kind assignment), then the published profile (kind profile)', async () => {
    const repo = repoWith([
      assignmentRow('GLOBAL', null, 'prof-g', 'asgn-glob-1'),
      profileRow('prof-g', 'Global Standard Profile'),
    ])
    const resolver = new RentalFlowConfigResolver(
      repo as unknown as Repository<RentalFlowConfig>
    )

    const result = await resolver.resolve({
      packageId: 'pk',
      durationMonths: 6,
    })

    expect(result.resolvedFrom.scope).toBe('GLOBAL')
    expect(result.resolvedFrom.profileId).toBe('prof-g')
    expect(repo.findOne.mock.calls.map(c => c[0])).toEqual([
      {
        where: {
          kind: 'assignment',
          scope: 'PACKAGE',
          scopeValue: 'pk',
          supersededAt: null,
        },
      },
      {
        where: {
          kind: 'assignment',
          scope: 'DURATION',
          scopeValue: '6',
          supersededAt: null,
        },
      },
      {
        where: { kind: 'assignment', scope: 'GLOBAL', supersededAt: null },
      },
      {
        where: {
          kind: 'profile',
          key: 'prof-g',
          status: 'published',
          version: 4,
        },
      },
    ])
  })

  it('PACKAGE assignment wins over DURATION and GLOBAL (Highest precedence)', async () => {
    const repo = repoWith([
      assignmentRow('PACKAGE', 'pkg-12m-vip', 'prof-pkg', 'asgn-pkg-1'),
      assignmentRow('GLOBAL', null, 'prof-g', 'asgn-glob-1'),
      profileRow('prof-pkg', 'Package Specific Profile', {
        ...DEFAULT_FLOW_PROFILE_STEPS,
        step2: {
          ...DEFAULT_FLOW_PROFILE_STEPS.step2,
          headerTitle: 'Custom Package Step 2',
        },
      }),
      profileRow('prof-g', 'Global Standard Profile'),
    ])
    const resolver = new RentalFlowConfigResolver(
      repo as unknown as Repository<RentalFlowConfig>
    )

    const result = await resolver.resolve({
      packageId: 'pkg-12m-vip',
      durationMonths: 12,
    })

    expect(result.resolvedFrom.scope).toBe('PACKAGE')
    expect(result.resolvedFrom.profileId).toBe('prof-pkg')
    expect(result.resolvedFrom.assignmentId).toBe('asgn-pkg-1')
    expect(result.effectiveConfig.step2.headerTitle).toBe(
      'Custom Package Step 2'
    )
  })

  it('DURATION assignment wins when PACKAGE is absent', async () => {
    const repo = repoWith([
      assignmentRow('DURATION', '12', 'prof-dur12', 'asgn-dur-1'),
      profileRow('prof-dur12', '12-Month Duration Profile'),
    ])
    const resolver = new RentalFlowConfigResolver(
      repo as unknown as Repository<RentalFlowConfig>
    )

    const result = await resolver.resolve({
      packageId: 'pkg-non-existent',
      durationMonths: 12,
    })

    expect(result.resolvedFrom.scope).toBe('DURATION')
    expect(result.resolvedFrom.scopeValue).toBe('12')
    expect(result.resolvedFrom.profileId).toBe('prof-dur12')
  })

  it('falls to the lower level when the profile of a PACKAGE assignment is not published', async () => {
    const repo = repoWith([
      assignmentRow('PACKAGE', 'pk', 'prof-gone', 'asgn-pkg-gone'),
      assignmentRow('DURATION', '3', 'prof-d', 'asgn-dur-3'),
      profileRow('prof-d', 'D'),
    ])
    const resolver = new RentalFlowConfigResolver(
      repo as unknown as Repository<RentalFlowConfig>
    )

    const result = await resolver.resolve({
      packageId: 'pk',
      durationMonths: 3,
    })

    expect(result.resolvedFrom.scope).toBe('DURATION')
    expect(repo.findOne.mock.calls.map(c => c[0])).toEqual(
      expect.arrayContaining([
        {
          where: {
            kind: 'profile',
            key: 'prof-gone',
            status: 'published',
            version: 4,
          },
        },
      ])
    )
  })

  it('does not pick a profile or policy row that shares a key with the referenced profile', async () => {
    const repo = repoWith([
      assignmentRow('GLOBAL', null, 'prof-x', 'asgn-glob-x'),
      {
        kind: 'policy',
        key: 'prof-x',
        name: 'Policy with the same key',
        status: 'published',
        version: 4,
        contentHash: 'hash-policy',
        strategy: 'SIGN_FIRST',
      },
      profileRow('prof-x', 'Profile X'),
    ])
    const resolver = new RentalFlowConfigResolver(
      repo as unknown as Repository<RentalFlowConfig>
    )

    const result = await resolver.resolve({})

    expect(result.resolvedFrom.profileName).toBe('Profile X')
    expect(result.effectiveConfig).toEqual(DEFAULT_FLOW_PROFILE_STEPS)
  })

  it('ignores rows of another kind that carry assignment-like fields', async () => {
    const repo = repoWith([
      {
        kind: 'policy',
        key: 'asgn-fake',
        scope: 'GLOBAL',
        scopeValue: null,
        supersededAt: null,
        profileRef: { profileId: 'prof-x', version: 4, contentHash: 'h' },
      },
      profileRow('prof-x', 'X'),
    ])
    const resolver = new RentalFlowConfigResolver(
      repo as unknown as Repository<RentalFlowConfig>
    )

    const result = await resolver.resolve({})

    expect(result.resolvedFrom.scope).toBe('SYSTEM_FALLBACK')
    expect(result.resolvedFrom.profileId).toBe(SAFE_DEFAULT_FLOW_PROFILE_ID)
  })

  it('falls back to safe hardcoded system profile when no assignments exist (Zero downtime guarantee)', async () => {
    const repo = repoWith([])
    const resolver = new RentalFlowConfigResolver(
      repo as unknown as Repository<RentalFlowConfig>
    )

    const result = await resolver.resolve({})

    expect(result.resolvedFrom.scope).toBe('SYSTEM_FALLBACK')
    expect(result.resolvedFrom.profileId).toBe(SAFE_DEFAULT_FLOW_PROFILE_ID)
    expect(result.effectiveConfig).toEqual(DEFAULT_FLOW_PROFILE_STEPS)
  })
})
