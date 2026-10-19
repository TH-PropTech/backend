import type {
  LegalTermsReviewStatus,
  LegalTermsSection,
} from '../schemas/legal-terms-document.schema'

export interface PublicLegalTermsResponse {
  key: string
  version: number
  title: string
  summary: string
  sections: LegalTermsSection[]
  contentHash: string
  publishedAt: Date | null
  /** Thời điểm có hiệu lực; null = hiệu lực từ `publishedAt`. */
  effectiveFrom: Date | null
}

export interface AdminLegalTermsStateResponse {
  /** Bản đang có hiệu lực. */
  published: PublicLegalTermsResponse | null
  /** Bản đã công bố nhưng chưa tới `effectiveFrom` (version cao nhất), nếu có. */
  scheduled: PublicLegalTermsResponse | null
  draft: {
    key: string
    title: string
    summary: string
    sections: LegalTermsSection[]
    draftRevision: number
    updatedBy?: string | undefined
    updatedAt: Date
    reviewStatus: LegalTermsReviewStatus
    submittedBy?: string | undefined
    submittedAt?: Date | undefined
    reviewedBy?: string | undefined
    reviewedAt?: Date | undefined
    reviewNote?: string | undefined
  } | null
}

/** Kết quả các thao tác chuyển trạng thái duyệt. */
export interface TermsReviewResultResponse {
  success: true
  draftRevision: number
  reviewStatus: LegalTermsReviewStatus
}
