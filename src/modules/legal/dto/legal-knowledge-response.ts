import type {
  LegalDocCategory,
  LegalDocStatus,
} from '../utils/legal-knowledge.types'

/** Admin list row (contract: LegalDocItem). Dates are ISO strings. */
export interface LegalDocItem {
  _id: string
  title: string
  category: LegalDocCategory
  docNumber?: string
  issuer?: string
  sourceUrl?: string
  keywords: string[]
  effectiveDate?: string
  expiryDate?: string
  status: LegalDocStatus
  chunkCount: number
  contentLength: number
  summary?: string
  contentSource: 'link' | 'manual'
  fetchedAt?: string
  createdAt: string
  updatedAt: string
}

/** Admin detail (contract: LegalDocDetail). `content` is the knowledge text. */
export interface LegalDocDetail extends LegalDocItem {
  content: string
}

/** Metadata suggested by the AI from a fetched page (contract: LegalSuggestion). */
export interface LegalSuggestion {
  title?: string
  docNumber?: string
  issuer?: string
  category?: LegalDocCategory
  keywords: string[]
  summary?: string
}

/** Response of POST /legal-knowledge/admin/fetch (contract). */
export interface FetchLegalLinkResult {
  url: string
  finalUrl: string
  pageTitle?: string
  rawCharCount: number
  content: string
  distilled: boolean
  suggestion: LegalSuggestion
}
