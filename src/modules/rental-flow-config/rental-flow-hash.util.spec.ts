import { computeCanonicalFlowProfileHash } from './rental-flow-hash.util'
import { DEFAULT_FLOW_PROFILE_STEPS } from './default-flow-profile'

describe('rental-flow-hash.util', () => {
  it('computes a consistent deterministic SHA-256 hash for identical input', () => {
    const hash1 = computeCanonicalFlowProfileHash({
      profileId: 'profile-1',
      name: 'Standard Profile',
      version: 1,
      steps: DEFAULT_FLOW_PROFILE_STEPS,
    })

    const hash2 = computeCanonicalFlowProfileHash({
      profileId: 'profile-1',
      name: 'Standard Profile',
      version: 1,
      steps: { ...DEFAULT_FLOW_PROFILE_STEPS },
    })

    expect(hash1).toHaveLength(64)
    expect(hash1).toBe(hash2)
  })

  it('produces identical hash regardless of object key ordering in steps', () => {
    const stepsReordered = {
      step4: DEFAULT_FLOW_PROFILE_STEPS.step4,
      step3: DEFAULT_FLOW_PROFILE_STEPS.step3,
      step2: DEFAULT_FLOW_PROFILE_STEPS.step2,
      step1: DEFAULT_FLOW_PROFILE_STEPS.step1,
    }

    const hash1 = computeCanonicalFlowProfileHash({
      profileId: 'profile-1',
      name: 'Standard Profile',
      version: 1,
      steps: DEFAULT_FLOW_PROFILE_STEPS,
    })

    const hash2 = computeCanonicalFlowProfileHash({
      profileId: 'profile-1',
      name: 'Standard Profile',
      version: 1,
      steps: stepsReordered,
    })

    expect(hash1).toBe(hash2)
  })

  it('produces different hashes when content changes', () => {
    const hash1 = computeCanonicalFlowProfileHash({
      profileId: 'profile-1',
      name: 'Standard Profile',
      version: 1,
      steps: DEFAULT_FLOW_PROFILE_STEPS,
    })

    const modifiedSteps = {
      ...DEFAULT_FLOW_PROFILE_STEPS,
      step1: {
        ...DEFAULT_FLOW_PROFILE_STEPS.step1,
        moveInDateLabel: 'Ngày dọn vào thực tế (đã đổi)',
      },
    }

    const hash2 = computeCanonicalFlowProfileHash({
      profileId: 'profile-1',
      name: 'Standard Profile',
      version: 1,
      steps: modifiedSteps,
    })

    expect(hash1).not.toBe(hash2)
  })
})
