import { isSha256, sha256Hex } from './canonical-json'

export const MOVE_IN_HANDOVER_EVIDENCE_SCHEMA_VERSION = 1 as const

export type MoveInHandoverEvidenceInput = {
  settlementId: string
  contractId: string
  revision: number
  handoverHash: string
  tenantConfirmationHash: string
  landlordConfirmationHash: string
  completedAt: string
  overrideUsed: boolean
}

export type MoveInHandoverEvidenceEnvelope = {
  schemaVersion: typeof MOVE_IN_HANDOVER_EVIDENCE_SCHEMA_VERSION
  settlementId: string
  contractId: string
  revision: number
  handoverHash: string
  tenantConfirmationHash: string
  landlordConfirmationHash: string
  completedAt: string
  overrideUsed: boolean
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
  'notes',
  'discrepancyNote',
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
  if (
    !isSha256(input.handoverHash) ||
    !isSha256(input.tenantConfirmationHash) ||
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
    schemaVersion: MOVE_IN_HANDOVER_EVIDENCE_SCHEMA_VERSION,
    settlementId: input.settlementId,
    contractId: input.contractId,
    revision: input.revision,
    handoverHash: input.handoverHash,
    tenantConfirmationHash: input.tenantConfirmationHash,
    landlordConfirmationHash: input.landlordConfirmationHash,
    completedAt: input.completedAt,
    overrideUsed: input.overrideUsed,
  }
}

export function hashMoveInHandoverEvidenceEnvelope(
  envelope: MoveInHandoverEvidenceEnvelope
): string {
  return sha256Hex(envelope)
}
