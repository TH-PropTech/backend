import type { ObjectId } from 'typeorm'
import type { ConfigAudit } from '../../activity-log/schemas/config-audit.schema'
import type { FlowAuditAction } from '../schemas/rental-flow-audit.schema'

/** Hình JSON cũ của audit luồng thuê (không lộ `scope`/`key`). */
export type RentalFlowAuditView = {
  _id: ObjectId
  action: FlowAuditAction
  actorId: string
  targetType: 'profile' | 'assignment' | 'contract' | 'execution-policy'
  targetId: string
  version?: number | null
  details?: Record<string, unknown> | null
  createdAt: Date
}

/** Ánh xạ ConfigAudit(scope = rental-flow) về DTO cũ. */
export function toRentalFlowAuditView(row: ConfigAudit): RentalFlowAuditView {
  return {
    _id: row._id,
    action: row.action as FlowAuditAction,
    actorId: row.actorId,
    targetType: row.targetType as RentalFlowAuditView['targetType'],
    targetId: row.key,
    ...(row.version !== undefined ? { version: row.version } : {}),
    ...(row.details !== undefined ? { details: row.details } : {}),
    createdAt: row.createdAt,
  }
}
