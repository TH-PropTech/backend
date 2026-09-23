import {
  buildSignedContractLedgerEvidence,
  hashSignedContractLedgerEvidence,
  parseSignedContractLedgerEvidence,
  assertSignedContractLedgerEvidence,
} from './ledger-evidence-envelope'

describe('signed contract ledger evidence envelope', () => {
  const artifact = {
    artifactId: 'artifact-1',
    revision: 3,
    artifactHash: 'a'.repeat(64),
    contentType: 'application/pdf' as const,
  }

  const signatures = {
    tenant: {
      providerTransactionId: 'sca-tenant-1',
      certificateSerial: 'serial-tenant-1',
      certificateSubject: 'CN=Tenant',
      certificateIssuer: 'CN=VNPT',
      signatureHash: 'b'.repeat(64),
      signatureAlgorithm: 'RSA-PSS-SHA256',
      signatureValueRef: 'sig-ref-tenant',
    },
    landlord: {
      providerTransactionId: 'sca-landlord-1',
      certificateSerial: 'serial-landlord-1',
      certificateSubject: 'CN=Landlord',
      certificateIssuer: 'CN=VNPT',
      signatureHash: 'c'.repeat(64),
      signatureAlgorithm: 'RSA-PSS-SHA256',
      signatureValueRef: 'sig-ref-landlord',
    },
  }

  it('builds a deterministic versioned envelope independent of object key order', () => {
    const first = buildSignedContractLedgerEvidence({
      contractId: 'contract-1',
      artifact,
      signatures,
      depositId: 'deposit-1',
      depositHash: 'd'.repeat(64),
    })
    const second = buildSignedContractLedgerEvidence({
      depositHash: 'd'.repeat(64),
      depositId: 'deposit-1',
      signatures: {
        landlord: { ...signatures.landlord },
        tenant: { ...signatures.tenant },
      },
      artifact: {
        contentType: 'application/pdf' as const,
        artifactHash: 'a'.repeat(64),
        revision: 3,
        artifactId: 'artifact-1',
      },
      contractId: 'contract-1',
    })

    expect(first).toEqual(second)
    expect(hashSignedContractLedgerEvidence(first)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashSignedContractLedgerEvidence(first)).toBe(
      hashSignedContractLedgerEvidence(second)
    )
  })

  it('reads a legacy artifact envelope without inventing signature evidence', () => {
    const parsed = parseSignedContractLedgerEvidence({
      contractHash: 'a'.repeat(64),
      artifactId: 'legacy-artifact',
      artifactRevision: 1,
    })

    expect(parsed).toEqual({
      schemaVersion: 1,
      contractHash: 'a'.repeat(64),
      artifactId: 'legacy-artifact',
      artifactRevision: 1,
      signatures: [],
    })
  })

  it('rejects tampered artifact or signature evidence and excludes PII', () => {
    const envelope = buildSignedContractLedgerEvidence({
      contractId: 'contract-1',
      artifact,
      signatures,
      depositId: null,
      depositHash: null,
    })

    expect(JSON.stringify(envelope)).not.toContain('Nguyen Tenant')
    expect(JSON.stringify(envelope)).not.toContain('079123456789')
    expect(() =>
      assertSignedContractLedgerEvidence(envelope, {
        artifact: { ...artifact, artifactHash: 'f'.repeat(64) },
        signatures,
      })
    ).toThrow('LEDGER_EVIDENCE_ARTIFACT_MISMATCH')
    expect(() =>
      assertSignedContractLedgerEvidence(envelope, {
        artifact,
        signatures: {
          ...signatures,
          tenant: { ...signatures.tenant, signatureHash: 'f'.repeat(64) },
        },
      })
    ).toThrow('LEDGER_EVIDENCE_SIGNATURE_MISMATCH')
  })
})
