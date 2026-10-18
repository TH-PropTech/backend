import { isSha256, sha256Hex } from './canonical-json'

/**
 * v2 thêm `completionReason` (phương án A: hoàn tất do hết hạn phản hồi). Bản hoàn tất
 * trước đó không có lý do nên vẫn dựng v1 — hash đã neo của chúng không đổi.
 */
export const MOVE_IN_HANDOVER_EVIDENCE_SCHEMA_VERSION = 2 as const
export type MoveInHandoverEvidenceSchemaVersion = 1 | 2
export type MoveInHandoverCompletionReason =
  | 'both-confirmed'
  | 'tenant-no-response'
const COMPLETION_REASONS: readonly string[] = [
  'both-confirmed',
  'tenant-no-response',
]

export type MoveInHandoverEvidenceInput = {
  settlementId: string
  contractId: string
  revision: number
  handoverHash: string
  tenantConfirmationHash: string
  landlordConfirmationHash: string
  completedAt: string
  overrideUsed: boolean
  /** Có → envelope v2; không có → v1 (bản hoàn tất cũ). */
  completionReason?: MoveInHandoverCompletionReason | null
}

export type MoveInHandoverEvidenceEnvelope = {
  schemaVersion: MoveInHandoverEvidenceSchemaVersion
  settlementId: string
  contractId: string
  revision: number
  handoverHash: string
  tenantConfirmationHash: string
  landlordConfirmationHash: string
  completedAt: string
  overrideUsed: boolean
  completionReason?: MoveInHandoverCompletionReason
}

const FORBIDDEN_FIELDS = [
  'tenantName',
  'tenantCccd',
  'landlordName',
  'landlordCccd',
  'tenantAddress',
  'landlordAddress',
  'meterReadings',
  'keyCount',
  'inventoryReference',
  'inventoryItems',
  'notes',
  'discrepancyNote',
  'discrepancies',
  'overrideReason',
  'recordedBy',
]

function assertNoForbiddenFields(input: Record<string, unknown>): void {
  for (const field of FORBIDDEN_FIELDS) {
    if (field in input) {
      throw new Error(`MOVE_IN_HANDOVER_EVIDENCE_FORBIDDEN_FIELD: ${field}`)
    }
  }
}

export function buildMoveInHandoverEvidenceEnvelope(
  input: MoveInHandoverEvidenceInput
): MoveInHandoverEvidenceEnvelope {
  assertNoForbiddenFields(input)

  if (!input.settlementId) {
    throw new Error('MOVE_IN_HANDOVER_EVIDENCE_SETTLEMENT_ID_REQUIRED')
  }
  if (!input.contractId) {
    throw new Error('MOVE_IN_HANDOVER_EVIDENCE_CONTRACT_ID_REQUIRED')
  }
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new Error('MOVE_IN_HANDOVER_EVIDENCE_REVISION_INVALID')
  }
  const reason = input.completionReason ?? null
  if (reason !== null && !COMPLETION_REASONS.includes(reason)) {
    throw new Error('MOVE_IN_HANDOVER_EVIDENCE_COMPLETION_REASON_INVALID')
  }
  // Hết hạn phản hồi: khách thuê không xác nhận nên không có hash xác nhận.
  const tenantHashOptional = reason === 'tenant-no-response'
  if (
    !isSha256(input.handoverHash) ||
    !(
      isSha256(input.tenantConfirmationHash) ||
      (tenantHashOptional && input.tenantConfirmationHash === '')
    ) ||
    !isSha256(input.landlordConfirmationHash)
  ) {
    throw new Error('MOVE_IN_HANDOVER_EVIDENCE_HASH_INVALID')
  }
  if (!input.completedAt || Number.isNaN(Date.parse(input.completedAt))) {
    throw new Error('MOVE_IN_HANDOVER_EVIDENCE_COMPLETED_AT_INVALID')
  }
  if (typeof input.overrideUsed !== 'boolean') {
    throw new Error('MOVE_IN_HANDOVER_EVIDENCE_OVERRIDE_USED_INVALID')
  }

  return {
    schemaVersion: reason ? MOVE_IN_HANDOVER_EVIDENCE_SCHEMA_VERSION : 1,
    settlementId: input.settlementId,
    contractId: input.contractId,
    revision: input.revision,
    handoverHash: input.handoverHash,
    tenantConfirmationHash: input.tenantConfirmationHash,
    landlordConfirmationHash: input.landlordConfirmationHash,
    completedAt: input.completedAt,
    overrideUsed: input.overrideUsed,
    ...(reason ? { completionReason: reason } : {}),
  }
}

export function hashMoveInHandoverEvidenceEnvelope(
  envelope: MoveInHandoverEvidenceEnvelope
): string {
  return sha256Hex(envelope)
}
