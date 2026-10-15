import type { AiConsultationLog } from '../../ai/schemas/ai-consultation-log.schema'
import type { BlockchainLog } from '../../fabric/schemas/blockchain-log.schema'
import type { JobRunHistory } from '../../jobs/schemas/job-run-history.schema'
import type { RecommendationHistory } from '../../properties/recommendations/schemas/recommendation-history.schema'
import type {
  ActivityLog,
  ActivityLogKind,
} from '../schemas/activity-log.schema'
import type { ConfigAudit } from '../schemas/config-audit.schema'

/** Hình JSON của ActivityLog HTTP (không có `kind`). */
export type HttpActivityLog = Omit<ActivityLog, 'kind'>

/**
 * Tập trường của từng loại trong hình cũ (kèm `_id`). Dùng cho mapper đọc và
 * cho migration rollback (chỉ sao đúng các trường này về collection cũ).
 */
export const LEGACY_LOG_FIELDS: Record<ActivityLogKind, readonly string[]> = {
  http: [
    '_id',
    'userId',
    'userRole',
    'method',
    'path',
    'action',
    'statusCode',
    'requestBody',
    'responseMessage',
    'ip',
    'userAgent',
    'targetInfo',
    'duration',
    'createdAt',
    'updatedAt',
  ],
  'job-run': [
    '_id',
    'jobName',
    'trigger',
    'status',
    'startedAt',
    'finishedAt',
    'durationMs',
    'result',
    'error',
    'createdAt',
    'updatedAt',
  ],
  recommendation: [
    '_id',
    'userAge',
    'userIncome',
    'preferredDistrict',
    'preferredBedrooms',
    'requiresGym',
    'requiresParking',
    'rentedApartmentId',
    'satisfactionScore',
    'createdAt',
  ],
  blockchain: [
    '_id',
    'action',
    'contractId',
    'paymentId',
    'depositId',
    'governanceSnapshotId',
    'settlementId',
    'handoverRevision',
    'schemaVersion',
    'payloadHash',
    'eventType',
    'networkMode',
    'status',
    'retryCount',
    'txHash',
    'blockNumber',
    'network',
    'details',
    'createdAt',
  ],
  'ai-consultation': [
    '_id',
    'logId',
    'userId',
    'messages',
    'status',
    'result',
    'recommendedPackage',
    'duration',
    'notes',
    'systemPrompt',
    'createdAt',
    'updatedAt',
  ],
  'config-audit': [
    '_id',
    'scope',
    'key',
    'version',
    'action',
    'actorId',
    'reason',
    'beforeHash',
    'afterHash',
    'targetType',
    'details',
    'createdAt',
  ],
}

/** Chỉ giữ khóa có giá trị (khác undefined; null vẫn giữ) theo danh sách trường. */
export function pickLegacyFields<T>(row: object, fields: readonly string[]): T {
  const source = row as Record<string, unknown>
  return Object.fromEntries(
    fields
      .filter(field => source[field] !== undefined)
      .map(field => [field, source[field]])
  ) as T
}

export function toHttpActivityLog(row: ActivityLog): HttpActivityLog {
  return pickLegacyFields<HttpActivityLog>(row, LEGACY_LOG_FIELDS.http)
}

export function toJobRunHistory(row: ActivityLog): JobRunHistory {
  return pickLegacyFields<JobRunHistory>(row, LEGACY_LOG_FIELDS['job-run'])
}

export function toRecommendationHistory(
  row: ActivityLog
): RecommendationHistory {
  return pickLegacyFields<RecommendationHistory>(
    row,
    LEGACY_LOG_FIELDS.recommendation
  )
}

export function toBlockchainLog(row: ActivityLog): BlockchainLog {
  return pickLegacyFields<BlockchainLog>(row, LEGACY_LOG_FIELDS.blockchain)
}

export function toAiConsultationLog(row: ActivityLog): AiConsultationLog {
  return pickLegacyFields<AiConsultationLog>(
    row,
    LEGACY_LOG_FIELDS['ai-consultation']
  )
}

/** Hình ConfigAudit cũ (không `kind`, không `updatedAt`). */
export function toConfigAudit(row: ActivityLog): ConfigAudit {
  return pickLegacyFields<ConfigAudit>(row, LEGACY_LOG_FIELDS['config-audit'])
}
