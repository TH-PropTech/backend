import type { LegalProfile } from './legal-profile.resolver'

export const LEASE_ARTICLE_NUMBERS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => index + 1)
)

export type LeaseArticle = {
  number: number
  heading: string
  contentHash: string
  protected: boolean
}

export type LeaseDocumentManifest = {
  legalProfile: LegalProfile
  articles: LeaseArticle[]
  annexes: string[]
}

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
      article => !article.protected || !article.contentHash
    )
  ) {
    errors.push('LEASE_PROTECTED_CONTENT_INVALID')
  }
  return { valid: errors.length === 0, errors }
}
