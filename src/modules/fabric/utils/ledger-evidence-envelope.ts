import { createHash } from 'node:crypto'
import { isSha256, stableStringify } from './canonical-json'

export const SIGNED_CONTRACT_LEDGER_EVIDENCE_SCHEMA_VERSION = 2 as const
export const SIGNED_CONTRACT_LEDGER_EVIDENCE_SCHEMA_VERSION_V3 = 3 as const

type SignerRole = 'tenant' | 'landlord'

/** Nhà cung cấp chữ ký ghi trên ledger ABI 3; `dev-test` là đường ký thử ngoài production. */
export const LEDGER_SIGNATURE_PROVIDERS = ['smartca', 'dev-test'] as const
export type LedgerSignatureProvider =
  (typeof LEDGER_SIGNATURE_PROVIDERS)[number]

/** Trần lãi chậm trả (%/năm) khớp `lease-compliance.validator.ts` và chaincode. */
const MAX_LATE_PENALTY_RATE_PER_YEAR = 20

export type LedgerEvidenceTerms = {
  latePenaltyRatePerYear: number
}

export type LedgerEvidenceArtifact = {
  artifactId: string
  revision: number
  artifactHash: string
  contentType: 'application/pdf'
}

export type LedgerEvidenceSignatureInput = {
  /** Bỏ trống thì envelope không có trường `provider` (giữ nguyên hash như trước ABI 3). */
  provider?: LedgerSignatureProvider
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
  /** Tỷ lệ lãi chậm trả hiệu lực lúc kích hoạt; chaincode ABI 3 neo giá trị này. */
  terms?: LedgerEvidenceTerms
}

export type SignedContractLedgerEvidenceEnvelope = {
  schemaVersion: typeof SIGNED_CONTRACT_LEDGER_EVIDENCE_SCHEMA_VERSION
  contractId: string
  artifact: LedgerEvidenceArtifact
  signatures: Record<
    SignerRole,
    {
      provider?: LedgerSignatureProvider
      providerTransactionRef: string
      certificateEvidenceRef: string
      signatureEvidenceRef: string | null
    }
  >
  deposit: {
    id: string | null
    hash: string | null
  }
  terms?: LedgerEvidenceTerms
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
  | SignedContractLedgerEvidenceEnvelopeV3
  | LegacySignedContractLedgerEvidence

function hashReference(value: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function signatureReference(input: LedgerEvidenceSignatureInput): {
  provider?: LedgerSignatureProvider
  providerTransactionRef: string
  certificateEvidenceRef: string
  signatureEvidenceRef: string | null
} {
  return {
    ...(input.provider ? { provider: input.provider } : {}),
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
  for (const role of ['tenant', 'landlord'] as const) {
    const provider = input.signatures[role].provider
    if (provider && !LEDGER_SIGNATURE_PROVIDERS.includes(provider)) {
      throw new Error('LEDGER_EVIDENCE_SIGNATURE_INVALID')
    }
  }
  if (input.terms) {
    const rate = input.terms.latePenaltyRatePerYear
    if (
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > MAX_LATE_PENALTY_RATE_PER_YEAR
    ) {
      throw new Error('LEDGER_EVIDENCE_TERMS_INVALID')
    }
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
    ...(input.terms
      ? {
          terms: { latePenaltyRatePerYear: input.terms.latePenaltyRatePerYear },
        }
      : {}),
  }
}

/** PROP-399 D2: tham chiếu bất biến tới snapshot cấu hình/pháp lý đã quản trị hợp đồng. */
export type SignedContractGovernanceReference = {
  snapshotId: string
  version: number
  manifestHash: string
}

export type SignedContractLedgerEvidenceInputV3 =
  SignedContractLedgerEvidenceInput & {
    governance: SignedContractGovernanceReference
  }

export type SignedContractLedgerEvidenceEnvelopeV3 = Omit<
  SignedContractLedgerEvidenceEnvelope,
  'schemaVersion'
> & {
  schemaVersion: typeof SIGNED_CONTRACT_LEDGER_EVIDENCE_SCHEMA_VERSION_V3
  governance: SignedContractGovernanceReference
}

/**
 * PROP-399 D2: bằng chứng hợp đồng đã ký, bản v3, gắn thêm tham chiếu
 * governance snapshot. Chỉ dùng khi contract có `governanceSnapshotRef`;
 * KHÔNG thay đổi `buildSignedContractLedgerEvidence` (v2) ở trên — hợp đồng
 * không có governance vẫn dùng v2 và giữ nguyên hash như trước.
 */
export function buildSignedContractLedgerEvidenceV3(
  input: SignedContractLedgerEvidenceInputV3
): SignedContractLedgerEvidenceEnvelopeV3 {
  const v2 = buildSignedContractLedgerEvidence(input)

  const { governance } = input
  if (
    !governance ||
    !governance.snapshotId ||
    !Number.isInteger(governance.version) ||
    governance.version < 1 ||
    !isSha256(governance.manifestHash)
  ) {
    throw new Error('LEDGER_EVIDENCE_GOVERNANCE_INVALID')
  }

  return {
    ...v2,
    schemaVersion: SIGNED_CONTRACT_LEDGER_EVIDENCE_SCHEMA_VERSION_V3,
    governance: { ...governance },
  }
}

export function hashSignedContractLedgerEvidence(
  envelope:
    | SignedContractLedgerEvidenceEnvelope
    | SignedContractLedgerEvidenceEnvelopeV3
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
      record.schemaVersion === SIGNED_CONTRACT_LEDGER_EVIDENCE_SCHEMA_VERSION_V3
    ) {
      const governance = record.governance as
        | Partial<SignedContractGovernanceReference>
        | undefined
      if (
        !governance ||
        typeof governance.snapshotId !== 'string' ||
        !governance.snapshotId ||
        !Number.isInteger(governance.version) ||
        (governance.version as number) < 1 ||
        !isSha256(governance.manifestHash)
      ) {
        throw new Error('LEDGER_EVIDENCE_GOVERNANCE_INVALID')
      }
      return value as SignedContractLedgerEvidenceEnvelopeV3
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
