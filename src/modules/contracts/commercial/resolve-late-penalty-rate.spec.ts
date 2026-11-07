import type { Contract } from '../schemas/contract.schema'
import {
  inferLatePenaltyRenderBranch,
  resolveLatePenaltyRate,
} from './resolve-late-penalty-rate'

const base = {
  monthlyRent: 10_000_000,
  deposit: 20_000_000,
  paymentDay: 1,
  terminationNoticeDays: 30,
  durationMonths: 12,
}

function contract(overrides: Record<string, unknown>): Contract {
  return { ...base, latePenaltyRate: 0, ...overrides } as unknown as Contract
}

const adminTemplate = { contractTemplateRef: { key: 'VN_LEASE', version: 2 } }

describe('resolveLatePenaltyRate', () => {
  it('infers the render branch like ContractArtifactService does', () => {
    expect(inferLatePenaltyRenderBranch(contract(adminTemplate))).toBe(
      'template'
    )
    expect(
      inferLatePenaltyRenderBranch(
        contract({ termsRef: { key: 'VN_PRIVATE_CIVIL', version: 1 } })
      )
    ).toBe('template')
    expect(
      inferLatePenaltyRenderBranch(
        contract({ termsRef: { key: 'legacy-terms', version: 1 } })
      )
    ).toBe('structured')
    expect(inferLatePenaltyRenderBranch(contract({}))).toBe('structured')
  })

  it('keeps 0 as 0 on an admin-template contract', () => {
    expect(
      resolveLatePenaltyRate(contract({ ...adminTemplate, latePenaltyRate: 0 }))
    ).toBe(0)
  })

  it('falls back to 10 when the structured layout has 0 or no rate', () => {
    expect(resolveLatePenaltyRate(contract({ latePenaltyRate: 0 }))).toBe(10)
    expect(
      resolveLatePenaltyRate(contract({ latePenaltyRate: undefined }))
    ).toBe(10)
    expect(resolveLatePenaltyRate(contract({ latePenaltyRate: 12 }))).toBe(12)
  })

  it('uses the signed amendment rate for the effective value but the original for the signed text', () => {
    const amended = contract({
      ...adminTemplate,
      latePenaltyRate: 12,
      contentLockedHash: 'locked',
      commercialDraft: { ...base, latePenaltyRate: 12 },
      effectiveCommercial: { ...base, latePenaltyRate: 8 },
    })
    expect(resolveLatePenaltyRate(amended)).toBe(8)
    expect(resolveLatePenaltyRate(amended, { source: 'signed' })).toBe(12)
  })

  it('honours an explicit render branch from the renderer', () => {
    const noRef = contract({ latePenaltyRate: 0 })
    expect(resolveLatePenaltyRate(noRef, { renderBranch: 'template' })).toBe(0)
    expect(
      resolveLatePenaltyRate(noRef, {
        renderBranch: 'structured',
        source: 'signed',
      })
    ).toBe(10)
  })
})
