import { createHash } from 'node:crypto'

export const SIGNED_CONTRACT_LEDGER_EVIDENCE_SCHEMA_VERSION = 2 as const

type SignerRole = 'tenant' | 'landlord'

export type LedgerEvidenceArtifact = {
  artifactId: string
  revision: number
  artifactHash: string
  contentType: 'application/pdf'
}

export type LedgerEvidenceSignatureInput = {
  providerTransactionId: string
  certificateSerial: string
  certificateSubject?: string | null
  certificateIssuer?: string | null
  signatureHash?: string | null
  signatureAlgorithm?: string | null
  signatureValueRef?: string | null
}

export type SignedContractLedgerEvidenceInput = {
  contractId: string
  artifact: LedgerEvidenceArtifact
  signatures: Record<SignerRole, LedgerEvidenceSignatureInput>
  depositId?: string | null
  depositHash?: string | null
}

export type SignedContractLedgerEvidenceEnvelope = {
  schemaVersion: typeof SIGNED_CONTRACT_LEDGER_EVIDENCE_SCHEMA_VERSION
  contractId: string
  artifact: LedgerEvidenceArtifact
  signatures: Record<
    SignerRole,
    {
      providerTransactionRef: string
      certificateEvidenceRef: string
      signatureEvidenceRef: string | null
    }
  >
  deposit: {
    id: string | null
    hash: string | null
  }
}

export type LegacySignedContractLedgerEvidence = {
  schemaVersion: 1
  contractHash: string
  artifactId: string | null
  artifactRevision: number | null
  signatures: []
}

export type ParsedSignedContractLedgerEvidence =
  | SignedContractLedgerEvidenceEnvelope
  | LegacySignedContractLedgerEvidence

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
  return `{${entries.join(',')}}`
}

function hashReference(value: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function signatureReference(input: LedgerEvidenceSignatureInput): {
  providerTransactionRef: string
  certificateEvidenceRef: string
  signatureEvidenceRef: string | null
} {
  return {
    providerTransactionRef: hashReference({
      providerTransactionId: input.providerTransactionId,
    }),
    certificateEvidenceRef: hashReference({
      certificateIssuer: input.certificateIssuer ?? null,
      certificateSerial: input.certificateSerial,
      certificateSubject: input.certificateSubject ?? null,
    }),
    signatureEvidenceRef:
      input.signatureHash || input.signatureAlgorithm || input.signatureValueRef
        ? hashReference({
            signatureAlgorithm: input.signatureAlgorithm ?? null,
            signatureHash: input.signatureHash ?? null,
            signatureValueRef: input.signatureValueRef ?? null,
          })
        : null,
  }
}

export function buildSignedContractLedgerEvidence(
  input: SignedContractLedgerEvidenceInput
): SignedContractLedgerEvidenceEnvelope {
  if (
    !input.contractId ||
    !input.artifact.artifactId ||
    input.artifact.revision < 1
  ) {
    throw new Error('LEDGER_EVIDENCE_ARTIFACT_INVALID')
  }
  if (
    input.artifact.contentType !== 'application/pdf' ||
    !isSha256(input.artifact.artifactHash)
  ) {
    throw new Error('LEDGER_EVIDENCE_ARTIFACT_INVALID')
  }
  if (
    !input.signatures.tenant.certificateSerial ||
    !input.signatures.landlord.certificateSerial
  ) {
    throw new Error('LEDGER_EVIDENCE_SIGNATURE_INVALID')
  }
  if (input.depositHash && !isSha256(input.depositHash)) {
    throw new Error('LEDGER_EVIDENCE_DEPOSIT_INVALID')
  }

  return {
    schemaVersion: SIGNED_CONTRACT_LEDGER_EVIDENCE_SCHEMA_VERSION,
    contractId: input.contractId,
    artifact: { ...input.artifact },
    signatures: {
      landlord: signatureReference(input.signatures.landlord),
      tenant: signatureReference(input.signatures.tenant),
    },
    deposit: {
      id: input.depositId ?? null,
      hash: input.depositHash ?? null,
    },
  }
}

export function hashSignedContractLedgerEvidence(
  envelope: SignedContractLedgerEvidenceEnvelope
): string {
  return createHash('sha256').update(stableStringify(envelope)).digest('hex')
}

export function parseSignedContractLedgerEvidence(
  value: unknown
): ParsedSignedContractLedgerEvidence {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.schemaVersion === 2) {
      return value as SignedContractLedgerEvidenceEnvelope
    }
    if (
      typeof record.contractHash === 'string' &&
      isSha256(record.contractHash) &&
      (typeof record.artifactId === 'string' || record.artifactId === null) &&
      (typeof record.artifactRevision === 'number' ||
        record.artifactRevision === null)
    ) {
      return {
        schemaVersion: 1,
        contractHash: record.contractHash,
        artifactId:
          typeof record.artifactId === 'string' ? record.artifactId : null,
        artifactRevision:
          typeof record.artifactRevision === 'number'
            ? record.artifactRevision
            : null,
        signatures: [],
      }
    }
  }
  throw new Error('LEDGER_EVIDENCE_ENVELOPE_INVALID')
}

export function assertSignedContractLedgerEvidence(
  envelope: SignedContractLedgerEvidenceEnvelope,
  current: {
    artifact: LedgerEvidenceArtifact
    signatures: Record<SignerRole, LedgerEvidenceSignatureInput>
  }
): void {
  if (
    envelope.artifact.artifactId !== current.artifact.artifactId ||
    envelope.artifact.revision !== current.artifact.revision ||
    envelope.artifact.artifactHash !== current.artifact.artifactHash ||
    envelope.artifact.contentType !== current.artifact.contentType
  ) {
    throw new Error('LEDGER_EVIDENCE_ARTIFACT_MISMATCH')
  }

  for (const role of ['tenant', 'landlord'] as const) {
    const expected = signatureReference(current.signatures[role])
    const actual = envelope.signatures[role]
    if (
      actual.providerTransactionRef !== expected.providerTransactionRef ||
      actual.certificateEvidenceRef !== expected.certificateEvidenceRef ||
      actual.signatureEvidenceRef !== expected.signatureEvidenceRef
    ) {
      throw new Error('LEDGER_EVIDENCE_SIGNATURE_MISMATCH')
    }
  }
}
