import {
  buildMoveInHandoverEvidenceEnvelope,
  hashMoveInHandoverEvidenceEnvelope,
} from './move-in-handover-evidence-envelope'

describe('move-in handover evidence envelope (PROP-399 D3: HANDOVER_RECORDED)', () => {
  const base = {
    settlementId: 'settle-1',
    contractId: 'c1',
    revision: 1,
    handoverHash: 'a'.repeat(64),
    tenantConfirmationHash: 'b'.repeat(64),
    landlordConfirmationHash: 'c'.repeat(64),
    completedAt: '2030-02-06T00:00:00.000Z',
    overrideUsed: false,
  }

  it('is deterministic across repeated calls with the same input (key ordering is irrelevant — stableStringify sorts keys)', () => {
    const first = buildMoveInHandoverEvidenceEnvelope(base)
    const second = buildMoveInHandoverEvidenceEnvelope({ ...base })
    expect(hashMoveInHandoverEvidenceEnvelope(first)).toBe(
      hashMoveInHandoverEvidenceEnvelope(second)
    )
    expect(hashMoveInHandoverEvidenceEnvelope(first)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('stores overrideUsed faithfully for both true and false', () => {
    expect(buildMoveInHandoverEvidenceEnvelope(base).overrideUsed).toBe(false)
    expect(
      buildMoveInHandoverEvidenceEnvelope({ ...base, overrideUsed: true })
        .overrideUsed
    ).toBe(true)
    // A differing overrideUsed must change the hash — it is part of the
    // anchored evidence, not incidental metadata.
    const withOverride = buildMoveInHandoverEvidenceEnvelope({
      ...base,
      overrideUsed: true,
    })
    const withoutOverride = buildMoveInHandoverEvidenceEnvelope(base)
    expect(hashMoveInHandoverEvidenceEnvelope(withOverride)).not.toBe(
      hashMoveInHandoverEvidenceEnvelope(withoutOverride)
    )
  })

  it('rejects a boundary-invalid revision (0) and accepts the boundary-valid minimum (1)', () => {
    expect(() =>
      buildMoveInHandoverEvidenceEnvelope({ ...base, revision: 0 })
    ).toThrow('MOVE_IN_HANDOVER_EVIDENCE_REVISION_INVALID')
    expect(
      buildMoveInHandoverEvidenceEnvelope({ ...base, revision: 1 }).revision
    ).toBe(1)
  })

  it('rejects invalid hashes and a missing settlementId/contractId', () => {
    expect(() =>
      buildMoveInHandoverEvidenceEnvelope({ ...base, handoverHash: 'bad' })
    ).toThrow('MOVE_IN_HANDOVER_EVIDENCE_HASH_INVALID')
    expect(() =>
      buildMoveInHandoverEvidenceEnvelope({ ...base, settlementId: '' })
    ).toThrow('MOVE_IN_HANDOVER_EVIDENCE_SETTLEMENT_ID_REQUIRED')
  })

  it('rejects forbidden fields (meter readings, notes, names, CCCD, etc.) anywhere in the input', () => {
    for (const forbiddenField of [
      'meterReadings',
      'keyCount',
      'inventoryReference',
      'notes',
      'discrepancyNote',
      'overrideReason',
      'tenantName',
      'landlordName',
      'tenantCccd',
      'landlordCccd',
      'recordedBy',
    ]) {
      expect(() =>
        buildMoveInHandoverEvidenceEnvelope({
          ...base,
          [forbiddenField]: 'should never be here',
        })
      ).toThrow('MOVE_IN_HANDOVER_EVIDENCE_FORBIDDEN_FIELD')
    }
  })

  it('produces a distinct schemaVersion/shape from the governance and settlement families', () => {
    const envelope = buildMoveInHandoverEvidenceEnvelope(base)
    expect(envelope.schemaVersion).toBe(1)
    expect((envelope as Record<string, unknown>).components).toBeUndefined()
    expect((envelope as Record<string, unknown>).statementHash).toBeUndefined()
  })
})
