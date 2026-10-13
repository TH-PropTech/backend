import { isSha256, sha256Hex } from './canonical-json'
import type { FabricGovernanceSnapshotComponents } from '../schemas/fabric-governance-snapshot.schema'

export const GOVERNANCE_EVIDENCE_SCHEMA_VERSION = 1 as const

export type GovernanceEvidenceInput = {
  snapshotCode: string
  components: FabricGovernanceSnapshotComponents
}

export type GovernanceEvidenceEnvelope = {
  manifestSchemaVersion: typeof GOVERNANCE_EVIDENCE_SCHEMA_VERSION
  snapshotCode: string
  components: FabricGovernanceSnapshotComponents
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
      throw new Error(`GOVERNANCE_EVIDENCE_FORBIDDEN_FIELD: ${field}`)
    }
  }
}

function assertComponentHash(value: unknown, label: string): void {
  if (!isSha256(value)) {
    throw new Error(`GOVERNANCE_EVIDENCE_HASH_INVALID: ${label}`)
  }
}

export function buildGovernanceEvidenceEnvelope(
  input: GovernanceEvidenceInput
): GovernanceEvidenceEnvelope {
  assertNoForbiddenFields(input)

  if (!input.snapshotCode) {
    throw new Error('GOVERNANCE_EVIDENCE_SNAPSHOT_CODE_REQUIRED')
  }
  if (!input.components) {
    throw new Error('GOVERNANCE_EVIDENCE_COMPONENTS_REQUIRED')
  }
  const { components } = input

  for (const term of components.legalTerms ?? []) {
    assertComponentHash(term.hash, 'legalTerms')
  }
  for (const policy of components.policySet ?? []) {
    assertComponentHash(policy.hash, 'policySet')
  }
  // D2 (2026-10-02 decision): một template/layout cho mỗi legal profile → mảng, template bắt buộc có ít nhất 1.
  if (
    !Array.isArray(components.contractTemplate) ||
    components.contractTemplate.length === 0
  ) {
    throw new Error('GOVERNANCE_EVIDENCE_HASH_INVALID: contractTemplate')
  }
  for (const template of components.contractTemplate) {
    assertComponentHash(template.hash, 'contractTemplate')
  }
  for (const layout of components.contractLayout ?? []) {
    assertComponentHash(layout.hash, 'contractLayout')
  }
  for (const policy of components.rentalExecutionPolicy ?? []) {
    assertComponentHash(policy.hash, 'rentalExecutionPolicy')
  }
  if (components.feeSchedule) {
    assertComponentHash(components.feeSchedule.hash, 'feeSchedule')
  }

  return {
    manifestSchemaVersion: GOVERNANCE_EVIDENCE_SCHEMA_VERSION,
    snapshotCode: input.snapshotCode,
    components,
  }
}

export function hashGovernanceEvidenceEnvelope(
  envelope: GovernanceEvidenceEnvelope
): string {
  return sha256Hex(envelope)
}
