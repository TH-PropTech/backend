import type { Repository } from 'typeorm'
import { RentalFlowConfigResolver } from './rental-flow-config-resolver.service'
import {
  DEFAULT_FLOW_PROFILE_STEPS,
  SAFE_DEFAULT_FLOW_PROFILE_ID,
} from '../utils/default-flow-profile'
import type { RentalFlowAssignment } from '../schemas/rental-flow-assignment.schema'
import type { RentalFlowProfile } from '../schemas/rental-flow-profile.schema'

interface MockRepo {
  findOne: jest.Mock
}

describe('RentalFlowConfigResolver', () => {
  let resolver: RentalFlowConfigResolver
  let mockAssignmentRepo: MockRepo
  let mockProfileRepo: MockRepo

  const now = new Date()
  const past = new Date(now.getTime() - 10000)

  beforeEach(() => {
    mockAssignmentRepo = {
      findOne: jest.fn(),
    }
    mockProfileRepo = {
      findOne: jest.fn(),
    }
    resolver = new RentalFlowConfigResolver(
      mockAssignmentRepo as unknown as Repository<RentalFlowAssignment>,
      mockProfileRepo as unknown as Repository<RentalFlowProfile>
    )
  })

  it('PACKAGE assignment wins over DURATION and GLOBAL (Highest precedence)', async () => {
    mockAssignmentRepo.findOne.mockResolvedValueOnce({
      scope: 'PACKAGE',
      scopeValue: 'pkg-12m-vip',
      profileRef: { profileId: 'prof-pkg', version: 3 },
      effectiveAt: past,
      assignmentId: 'asgn-pkg-1',
    })

    mockProfileRepo.findOne.mockResolvedValueOnce({
      profileId: 'prof-pkg',
      name: 'Package Specific Profile',
      version: 3,
      contentHash: 'hash-pkg',
      steps: {
        ...DEFAULT_FLOW_PROFILE_STEPS,
        step2: {
          ...DEFAULT_FLOW_PROFILE_STEPS.step2,
          headerTitle: 'Custom Package Step 2',
        },
      },
    })

    const result = await resolver.resolve({
      packageId: 'pkg-12m-vip',
      durationMonths: 12,
    })

    expect(result.resolvedFrom.scope).toBe('PACKAGE')
    expect(result.resolvedFrom.profileId).toBe('prof-pkg')
    expect(result.effectiveConfig.step2.headerTitle).toBe(
      'Custom Package Step 2'
    )
  })

  it('DURATION assignment wins when PACKAGE is absent', async () => {
    // 1st call for PACKAGE -> null
    mockAssignmentRepo.findOne.mockResolvedValueOnce(null)
    // 2nd call for DURATION -> found
    mockAssignmentRepo.findOne.mockResolvedValueOnce({
      scope: 'DURATION',
      scopeValue: '12',
      profileRef: { profileId: 'prof-dur12', version: 2 },
      effectiveAt: past,
      assignmentId: 'asgn-dur-1',
    })

    mockProfileRepo.findOne.mockResolvedValueOnce({
      profileId: 'prof-dur12',
      name: '12-Month Duration Profile',
      version: 2,
      contentHash: 'hash-dur12',
      steps: DEFAULT_FLOW_PROFILE_STEPS,
    })

    const result = await resolver.resolve({
      packageId: 'pkg-non-existent',
      durationMonths: 12,
    })

    expect(result.resolvedFrom.scope).toBe('DURATION')
    expect(result.resolvedFrom.scopeValue).toBe('12')
    expect(result.resolvedFrom.profileId).toBe('prof-dur12')
  })

  it('GLOBAL assignment applies when neither PACKAGE nor DURATION match', async () => {
    // 1st call: PACKAGE -> null
    mockAssignmentRepo.findOne.mockResolvedValueOnce(null)
    // 2nd call: DURATION -> null
    mockAssignmentRepo.findOne.mockResolvedValueOnce(null)
    // 3rd call: GLOBAL -> found
    mockAssignmentRepo.findOne.mockResolvedValueOnce({
      scope: 'GLOBAL',
      scopeValue: null,
      profileRef: { profileId: 'prof-global', version: 1 },
      effectiveAt: past,
      assignmentId: 'asgn-glob-1',
    })

    mockProfileRepo.findOne.mockResolvedValueOnce({
      profileId: 'prof-global',
      name: 'Global Standard Profile',
      version: 1,
      contentHash: 'hash-global',
      steps: DEFAULT_FLOW_PROFILE_STEPS,
    })

    const result = await resolver.resolve({
      packageId: 'pkg-standard',
      durationMonths: 6,
    })

    expect(result.resolvedFrom.scope).toBe('GLOBAL')
    expect(result.resolvedFrom.profileId).toBe('prof-global')
  })

  it('falls back to safe hardcoded system profile when no assignments exist (Zero downtime guarantee)', async () => {
    // All queries return null
    mockAssignmentRepo.findOne.mockResolvedValue(null)

    const result = await resolver.resolve({})

    expect(result.resolvedFrom.scope).toBe('SYSTEM_FALLBACK')
    expect(result.resolvedFrom.profileId).toBe(SAFE_DEFAULT_FLOW_PROFILE_ID)
    expect(result.effectiveConfig).toEqual(DEFAULT_FLOW_PROFILE_STEPS)
  })
})
