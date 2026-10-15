import type { ReviewCase } from '../schemas/review-case.schema'
import type { ListingReviewCase } from '../schemas/listing-review-case.schema'
import type { SafetyReport } from '../insights/schemas/safety-report.schema'

/** Bản ghi `kind = 'safety'` với các trường bắt buộc của hình `SafetyReport` cũ. */
export type SafetyReviewRow = ReviewCase &
  Pick<
    SafetyReport,
    | 'reporterId'
    | 'reporterRole'
    | 'targetType'
    | 'targetId'
    | 'category'
    | 'description'
    | 'evidenceUrls'
    | 'riskLevel'
    | 'isTargetHidden'
  > & { kind: 'safety' }

export function asSafetyRow(row: ReviewCase): SafetyReviewRow {
  return row as SafetyReviewRow
}

/** Chỉ giữ khóa có giá trị (khác undefined) để JSON khớp bản ghi cũ. */
function defined<T>(value: object): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T
}

/** Hình JSON cũ của ListingReviewCase (không lộ `kind`). */
export function toListingReviewCase(row: ReviewCase): ListingReviewCase {
  return defined<ListingReviewCase>({
    _id: row._id,
    apartmentId: row.apartmentId,
    type: row.type,
    confidence: row.confidence,
    relatedApartmentId: row.relatedApartmentId,
    status: row.status,
    evidence: row.evidence,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

/** Hình JSON cũ của SafetyReport (không lộ `kind`). */
export function toSafetyReport(row: ReviewCase): SafetyReport {
  return defined<SafetyReport>({
    _id: row._id,
    reporterId: row.reporterId,
    reporterRole: row.reporterRole,
    targetType: row.targetType,
    targetId: row.targetId,
    targetTitle: row.targetTitle,
    category: row.category,
    description: row.description,
    evidenceUrls: row.evidenceUrls,
    riskLevel: row.riskLevel,
    status: row.status,
    resolutionCode: row.resolutionCode,
    resolutionNote: row.resolutionNote,
    assignedTo: row.assignedTo,
    assignedAt: row.assignedAt,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt,
    isTargetHidden: row.isTargetHidden,
    appealReason: row.appealReason,
    appealedAt: row.appealedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}
