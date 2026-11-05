import type { LegalProfile } from './legal-profile.resolver'

/** Phụ lục chứa điều khoản riêng của chủ nhà; luôn nằm sau 12 điều khung và không thay thế điều nào. */
export const CUSTOM_CLAUSES_ANNEX_ID = 'LANDLORD_CUSTOM_CLAUSES'

export const LEASE_ARTICLE_NUMBERS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => index + 1)
)

export type LeaseArticle = {
  id?: string
  number: number
  heading: string
  content?: string
  variableRefs?: string[]
  contentHash: string
  citationIds?: string[]
  protected: boolean
}

export type LeaseDocumentManifest = {
  legalProfile: LegalProfile
  articles: LeaseArticle[]
  annexes: Array<string | { id: string; title: string; required: boolean }>
  citationIds?: string[]
  schemaVersion?: number
  contentHash?: string
}

export type LeaseTemplateProfile = {
  id: 'VN_RE_BUSINESS_ND96_APPENDIX_II' | 'VN_INDIVIDUAL_RESIDENTIAL_LEASE'
  legalProfile: LegalProfile
  citationIds: readonly string[]
  referenceOnly: boolean
}

/** Reviewed seed profiles; individual leases use Appendix II as a reference only. */
export const LEASE_TEMPLATE_PROFILES: readonly LeaseTemplateProfile[] = [
  {
    id: 'VN_RE_BUSINESS_ND96_APPENDIX_II',
    legalProfile: 'REAL_ESTATE_BUSINESS_STANDARD',
    citationIds: ['DECREE_96_2024_APPENDIX_II_RESIDENTIAL_LEASE'],
    referenceOnly: false,
  },
  {
    id: 'VN_INDIVIDUAL_RESIDENTIAL_LEASE',
    legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
    citationIds: [
      'DECREE_96_2024_APPENDIX_II_RESIDENTIAL_LEASE',
      'HOUSING_LAW_2023_ART_163_164',
    ],
    referenceOnly: true,
  },
]

export type LegalValidationResult = {
  valid: boolean
  errors: string[]
}

export function validateDocumentManifest(
  manifest: LeaseDocumentManifest
): LegalValidationResult {
  const errors: string[] = []
  const articleNumbers = manifest.articles.map(article => article.number)
  if (articleNumbers.length !== LEASE_ARTICLE_NUMBERS.length) {
    errors.push('LEASE_ARTICLE_COUNT_INVALID')
  }
  for (const articleNumber of LEASE_ARTICLE_NUMBERS) {
    if (!articleNumbers.includes(articleNumber))
      errors.push(`LEASE_ARTICLE_${articleNumber}_MISSING`)
  }
  if (manifest.annexes.length === 0) errors.push('LEASE_ANNEX_REQUIRED')
  if (
    manifest.articles.some(
      article =>
        !article.heading.trim() ||
        (article.content !== undefined && !article.content.trim())
    )
  ) {
    errors.push('LEASE_ARTICLE_CONTENT_INVALID')
  }
  if (
    manifest.articles.some(
      article => !article.protected || !article.contentHash
    )
  ) {
    errors.push('LEASE_PROTECTED_CONTENT_INVALID')
  }
  if (manifest.citationIds && manifest.citationIds.length === 0) {
    errors.push('LEASE_CITATION_REQUIRED')
  }
  return { valid: errors.length === 0, errors }
}
