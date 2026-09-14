import type { LegalTermsSection } from '../schemas/legal-terms-document.schema'

export interface PublicLegalTermsResponse {
  key: string
  version: number
  title: string
  summary: string
  sections: LegalTermsSection[]
  contentHash: string
  publishedAt: Date | null
}

export interface AdminLegalTermsStateResponse {
  published: PublicLegalTermsResponse | null
  draft: {
    key: string
    title: string
    summary: string
    sections: LegalTermsSection[]
    draftRevision: number
    updatedBy?: string | undefined
    updatedAt: Date
  } | null
}
