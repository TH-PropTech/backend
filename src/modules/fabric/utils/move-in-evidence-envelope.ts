import { isSha256, sha256Hex } from './canonical-json'

export const MOVE_IN_SETTLEMENT_EVIDENCE_SCHEMA_VERSION = 1 as const

export type MoveInSettlementEvidenceLineKind =
  | 'DEPOSIT_TOPUP'
  | 'FIRST_RENT'
  | 'TENANT_SERVICE_FEE'

export type MoveInSettlementEvidenceLine = {
  kind: MoveInSettlementEvidenceLineKind
  amount: number
  paymentId: string | null
}

export type MoveInSettlementEvidenceInput = {
  settlementId: string
  contractId: string
  statementHash: string
  lines: MoveInSettlementEvidenceLine[]
  total: number
  paidAt: string
}

export type MoveInSettlementEvidenceEnvelope = {
  schemaVersion: typeof MOVE_IN_SETTLEMENT_EVIDENCE_SCHEMA_VERSION
  settlementId: string
  contractId: string
  statementHash: string
  lines: MoveInSettlementEvidenceLine[]
  total: number
  paidAt: string
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
      throw new Error(`MOVE_IN_SETTLEMENT_EVIDENCE_FORBIDDEN_FIELD: ${field}`)
    }
  }
}

export function buildMoveInSettlementEvidenceEnvelope(
  input: MoveInSettlementEvidenceInput
): MoveInSettlementEvidenceEnvelope {
  assertNoForbiddenFields(input)

  if (!input.settlementId) {
    throw new Error('MOVE_IN_SETTLEMENT_EVIDENCE_SETTLEMENT_ID_REQUIRED')
  }
  if (!input.contractId) {
    throw new Error('MOVE_IN_SETTLEMENT_EVIDENCE_CONTRACT_ID_REQUIRED')
  }
  if (!isSha256(input.statementHash)) {
    throw new Error('MOVE_IN_SETTLEMENT_EVIDENCE_HASH_INVALID')
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error('MOVE_IN_SETTLEMENT_EVIDENCE_LINES_REQUIRED')
  }
  for (const line of input.lines) {
    if (!Number.isFinite(line.amount) || line.amount < 0) {
      throw new Error('MOVE_IN_SETTLEMENT_EVIDENCE_LINE_AMOUNT_INVALID')
    }
  }
  if (!Number.isFinite(input.total) || input.total < 0) {
    throw new Error('MOVE_IN_SETTLEMENT_EVIDENCE_TOTAL_INVALID')
  }
  if (!input.paidAt || Number.isNaN(Date.parse(input.paidAt))) {
    throw new Error('MOVE_IN_SETTLEMENT_EVIDENCE_PAID_AT_INVALID')
  }

  const sortedLines = [...input.lines]
    .map(line => ({ ...line }))
    .sort((a, b) => a.kind.localeCompare(b.kind))

  return {
    schemaVersion: MOVE_IN_SETTLEMENT_EVIDENCE_SCHEMA_VERSION,
    settlementId: input.settlementId,
    contractId: input.contractId,
    statementHash: input.statementHash,
    lines: sortedLines,
    total: input.total,
    paidAt: input.paidAt,
  }
}

export function hashMoveInSettlementEvidenceEnvelope(
  envelope: MoveInSettlementEvidenceEnvelope
): string {
  return sha256Hex(envelope)
}
