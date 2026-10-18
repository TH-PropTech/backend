/** DI token: lets the chat bot search the legal knowledge base without importing the service class. */
export const LEGAL_KNOWLEDGE_SEARCH = Symbol('LEGAL_KNOWLEDGE_SEARCH')

export const LEGAL_DOC_CATEGORIES = [
  'luat',
  'nghi-dinh',
  'thong-tu',
  'quyet-dinh',
  'noi-quy',
  'hop-dong-mau',
  'thu-tuc',
  'faq',
  'khac',
] as const
export type LegalDocCategory = (typeof LEGAL_DOC_CATEGORIES)[number]

export type LegalDocStatus = 'draft' | 'published' | 'archived'

/** One searchable excerpt returned to the chat bot / admin test box. */
export interface LegalSearchHit {
  docId: string
  title: string
  docNumber?: string | undefined
  issuer?: string | undefined
  /** e.g. "Điều 472. Hợp đồng thuê tài sản" */
  heading?: string | undefined
  text: string
  score: number
  /** Share (0..1) of the question's weighted words found in this passage (see Bm25Hit.coverage). */
  coverage: number
  sourceUrl?: string | undefined
  /** ISO time the text was last taken from the source link (or last updated). */
  fetchedAt?: string | undefined
}

export interface LegalKnowledgeSearcher {
  /** Only PUBLISHED documents are searched. Returns at most `limit` (default 4) hits, best first. */
  search(query: string, limit?: number): Promise<LegalSearchHit[]>
}

/** Citation shown under a chat bot answer (chat message metadata `legalCitations`). */
export interface LegalCitation {
  title: string
  heading?: string | undefined
  url?: string | undefined
  issuer?: string | undefined
  /** ISO time the cited text was last taken from the source. */
  fetchedAt?: string | undefined
}

export interface LegalChunkDraft {
  order: number
  heading?: string | undefined
  text: string
}
