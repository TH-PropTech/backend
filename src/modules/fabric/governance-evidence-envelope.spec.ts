import {
  buildGovernanceEvidenceEnvelope,
  hashGovernanceEvidenceEnvelope,
} from './governance-evidence-envelope'

describe('governance evidence envelope (PROP-399 D2)', () => {
  const components = {
    legalTerms: [{ id: 'term-1', version: 1, hash: 'a'.repeat(64) }],
    policySet: [
      { key: 'MAX_DEPOSIT_RATE', value: '10', unit: '%', hash: 'b'.repeat(64) },
    ],
    contractTemplate: [
      { id: 'template-1', version: 3, hash: 'c'.repeat(64) },
      { id: 'template-2', version: 1, hash: '2'.repeat(64) },
    ],
    contractLayout: [{ id: 'layout-1', version: 1, hash: 'd'.repeat(64) }],
    rentalExecutionPolicy: [
      { policyId: 'DEPOSIT_FIRST', version: 1, hash: 'e'.repeat(64) },
      { policyId: 'SIGN_FIRST', version: 1, hash: '1'.repeat(64) },
    ],
    feeSchedule: { id: 'fee-1', version: 1, hash: 'f'.repeat(64) },
  }

  it('is independent of input key order and deterministic across calls (hash determinism, key ordering)', () => {
    const first = buildGovernanceEvidenceEnvelope({
      snapshotCode: 'snap-1',
      components,
    })
    const reordered = buildGovernanceEvidenceEnvelope({
      components: { ...components },
      snapshotCode: 'snap-1',
    })
    expect(hashGovernanceEvidenceEnvelope(first)).toBe(
      hashGovernanceEvidenceEnvelope(reordered)
    )
    expect(hashGovernanceEvidenceEnvelope(first)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a missing snapshotCode or components', () => {
    expect(() =>
      buildGovernanceEvidenceEnvelope({
        snapshotCode: '',
        components,
      })
    ).toThrow('GOVERNANCE_EVIDENCE_SNAPSHOT_CODE_REQUIRED')
    expect(() =>
      buildGovernanceEvidenceEnvelope({
        snapshotCode: 'snap-1',
        components: undefined as never,
      })
    ).toThrow('GOVERNANCE_EVIDENCE_COMPONENTS_REQUIRED')
  })

  it('rejects an invalid component hash', () => {
    expect(() =>
      buildGovernanceEvidenceEnvelope({
        snapshotCode: 'snap-1',
        components: {
          ...components,
          contractTemplate: [{ id: 'template-1', version: 3, hash: 'bad' }],
        },
      })
    ).toThrow('GOVERNANCE_EVIDENCE_HASH_INVALID')
  })

  it('requires at least one contract template and rejects a bad layout hash', () => {
    expect(() =>
      buildGovernanceEvidenceEnvelope({
        snapshotCode: 'snap-1',
        components: { ...components, contractTemplate: [] },
      })
    ).toThrow('GOVERNANCE_EVIDENCE_HASH_INVALID')
    expect(() =>
      buildGovernanceEvidenceEnvelope({
        snapshotCode: 'snap-1',
        components: {
          ...components,
          contractLayout: [{ id: 'layout-1', version: 1, hash: 'bad' }],
        },
      })
    ).toThrow('GOVERNANCE_EVIDENCE_HASH_INVALID')
    expect(
      buildGovernanceEvidenceEnvelope({
        snapshotCode: 'snap-1',
        components: { ...components, contractLayout: null },
      }).components.contractLayout
    ).toBeNull()
  })

  it('rejects forbidden PII-shaped fields anywhere in the input', () => {
    expect(() =>
      buildGovernanceEvidenceEnvelope({
        snapshotCode: 'snap-1',
        components,
        tenantName: 'Nguyen Van A',
      } as never)
    ).toThrow('GOVERNANCE_EVIDENCE_FORBIDDEN_FIELD')
  })

  it('produces a distinct schemaVersion/shape from the settlement and handover families', () => {
    const envelope = buildGovernanceEvidenceEnvelope({
      snapshotCode: 'snap-1',
      components,
    })
    expect(envelope.manifestSchemaVersion).toBe(1)
    expect(envelope.snapshotCode).toBe('snap-1')
    expect((envelope as Record<string, unknown>).settlementId).toBeUndefined()
    expect((envelope as Record<string, unknown>).handoverHash).toBeUndefined()
  })
})
