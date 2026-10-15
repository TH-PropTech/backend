import type { ObjectId } from 'typeorm'
import type { ConfigAudit } from '../../activity-log/schemas/config-audit.schema'
import type { ContractTemplateAuditAction } from '../schemas/contract-template-audit.schema'

/** Hình JSON cũ của `GET /contract-templates/:templateKey/audits` (không lộ `scope`/`key`). */
export type ContractTemplateAuditView = {
  _id: ObjectId
  templateKey: string
  version: number
  action: ContractTemplateAuditAction
  actorId: string
  reason?: string | null
  beforeHash?: string | null
  afterHash?: string | null
  reviewReference?: string | null
  deniedField?: string | null
  metadata?: Record<string, string> | null
  createdAt: Date
}

/** Ánh xạ ConfigAudit(scope = contract-template) về DTO cũ; chỉ trường có mặt mới được xuất. */
export function toContractTemplateAuditView(
  row: ConfigAudit
): ContractTemplateAuditView {
  const details = row.details ?? {}
  return {
    _id: row._id,
    templateKey: row.key,
    version: row.version as number,
    action: row.action as ContractTemplateAuditAction,
    actorId: row.actorId,
    ...(row.reason !== undefined ? { reason: row.reason } : {}),
    ...(row.beforeHash !== undefined ? { beforeHash: row.beforeHash } : {}),
    ...(row.afterHash !== undefined ? { afterHash: row.afterHash } : {}),
    ...(details.reviewReference !== undefined
      ? { reviewReference: details.reviewReference as string | null }
      : {}),
    ...(details.deniedField !== undefined
      ? { deniedField: details.deniedField as string | null }
      : {}),
    ...(details.metadata !== undefined
      ? { metadata: details.metadata as Record<string, string> | null }
      : {}),
    createdAt: row.createdAt,
  }
}
