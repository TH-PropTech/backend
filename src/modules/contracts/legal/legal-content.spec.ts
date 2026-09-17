import {
  canonicalizeTipTapContent,
  sanitizeTipTapContent,
} from './tiptap-content'
import { getActiveLegalBasis } from './legal-basis.registry'
import { resolveLegalProfile } from './legal-profile.resolver'
import {
  validateDocumentManifest,
  LEASE_ARTICLE_NUMBERS,
  LEASE_TEMPLATE_PROFILES,
} from './lease-template.manifest'
import { validateDepositDisposition } from './deposit-disposition.validator'

describe('contract legal boundaries', () => {
  it('sanitizes allowlisted TipTap nodes and canonicalizes key order', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }],
        },
      ],
      unexpected: '<script>alert(1)</script>',
    }
    const sanitized = sanitizeTipTapContent(content)
    expect(sanitized).not.toHaveProperty('unexpected')
    expect(canonicalizeTipTapContent(content)).toContain('Hello')
  })

  it('rejects unsafe marks and invalid payloads', () => {
    expect(() =>
      sanitizeTipTapContent({ type: 'doc', content: [{ type: 'rawHtml' }] })
    ).toThrow('TIPTAP_NODE_NOT_ALLOWED')
    expect(() =>
      sanitizeTipTapContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ],
      })
    ).toThrow('TIPTAP_LINK_INVALID')
  })

  it('resolves legal profile and only returns active legal basis entries', () => {
    expect(
      resolveLegalProfile({
        landlordType: 'business',
        operatesRealEstateBusiness: true,
      })
    ).toBe('REAL_ESTATE_BUSINESS_STANDARD')
    expect(getActiveLegalBasis(['HOUSING_LAW_2023_ART_163_164'])).toHaveLength(
      1
    )
    expect(() => getActiveLegalBasis(['unknown'])).toThrow(
      'LEGAL_BASIS_NOT_ACTIVE'
    )
    expect(
      getActiveLegalBasis(['DECREE_96_2024_APPENDIX_II_RESIDENTIAL_LEASE'])
    ).toHaveLength(1)
  })

  it('seeds distinct business and individual lease profiles with reference semantics', () => {
    expect(LEASE_TEMPLATE_PROFILES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'VN_RE_BUSINESS_ND96_APPENDIX_II',
          legalProfile: 'REAL_ESTATE_BUSINESS_STANDARD',
          referenceOnly: false,
        }),
        expect.objectContaining({
          id: 'VN_INDIVIDUAL_RESIDENTIAL_LEASE',
          legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
          referenceOnly: true,
        }),
      ])
    )
  })

  it('fails closed when the twelve-article manifest or annex is incomplete', () => {
    const articles = LEASE_ARTICLE_NUMBERS.map(number => ({
      number,
      heading: `Article ${number}`,
      contentHash: 'a'.repeat(64),
      protected: true,
    }))
    expect(
      validateDocumentManifest({
        legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
        articles,
        annexes: ['payment-schedule'],
      }).valid
    ).toBe(true)
    expect(
      validateDocumentManifest({
        legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
        articles: articles.slice(0, 11),
        annexes: [],
      }).valid
    ).toBe(false)
  })

  it('enforces deposit purpose and outcome compatibility', () => {
    expect(validateDepositDisposition('SECURE_CONCLUSION', 'refund')).toBe(true)
    expect(() =>
      validateDepositDisposition('SECURE_CONCLUSION', 'forfeit')
    ).toThrow('DEPOSIT_OUTCOME_NOT_ALLOWED')
  })
})
