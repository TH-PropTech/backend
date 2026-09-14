import { UnprocessableEntityException } from '@nestjs/common'
import { validateFlowProfileSteps } from './rental-flow-validator.util'
import { DEFAULT_FLOW_PROFILE_STEPS } from './default-flow-profile'

describe('rental-flow-validator.util', () => {
  it('validates default safe steps with zero errors (Happy Path)', () => {
    expect(() =>
      validateFlowProfileSteps(DEFAULT_FLOW_PROFILE_STEPS)
    ).not.toThrow()
  })

  it('rejects steps containing forbidden commercial keys', () => {
    const maliciousSteps = {
      ...DEFAULT_FLOW_PROFILE_STEPS,
      step2: {
        ...DEFAULT_FLOW_PROFILE_STEPS.step2,
        monthlyRent: 15000000,
      } as unknown as typeof DEFAULT_FLOW_PROFILE_STEPS.step2,
    }

    expect(() => validateFlowProfileSteps(maliciousSteps)).toThrow(
      UnprocessableEntityException
    )
  })

  it('rejects steps containing malicious script tags or javascript protocols', () => {
    const xssSteps = {
      ...DEFAULT_FLOW_PROFILE_STEPS,
      step1: {
        ...DEFAULT_FLOW_PROFILE_STEPS.step1,
        moveInDateLabel: 'Ngày vào <script>alert(1)</script>',
      },
    }

    expect(() => validateFlowProfileSteps(xssSteps)).toThrow(
      UnprocessableEntityException
    )
  })

  it('rejects boundary violations for occupants and lead days', () => {
    const invalidOccupants = {
      ...DEFAULT_FLOW_PROFILE_STEPS,
      step1: {
        ...DEFAULT_FLOW_PROFILE_STEPS.step1,
        minOccupants: 0, // Min is 1
      },
    }
    expect(() => validateFlowProfileSteps(invalidOccupants)).toThrow(
      UnprocessableEntityException
    )

    const invalidLeadDays = {
      ...DEFAULT_FLOW_PROFILE_STEPS,
      step1: {
        ...DEFAULT_FLOW_PROFILE_STEPS.step1,
        maxMoveInLeadDays: 500, // Max is 365
      },
    }
    expect(() => validateFlowProfileSteps(invalidLeadDays)).toThrow(
      UnprocessableEntityException
    )
  })

  it('rejects attempt to disable immutable required disclosures', () => {
    const downgradedDisclosure = {
      ...DEFAULT_FLOW_PROFILE_STEPS,
      step3: {
        ...DEFAULT_FLOW_PROFILE_STEPS.step3,
        disclosures: [
          {
            id: 'listing-terms',
            title: 'Terms',
            body: 'Body',
            required: false, // Attempting to downgrade required!
            immutablePolicy: true,
          },
        ],
      },
    }

    expect(() => validateFlowProfileSteps(downgradedDisclosure)).toThrow(
      UnprocessableEntityException
    )
  })
})
