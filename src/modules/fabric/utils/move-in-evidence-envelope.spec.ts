import {
  buildMoveInSettlementEvidenceEnvelope,
  hashMoveInSettlementEvidenceEnvelope,
} from './move-in-evidence-envelope'

describe('move-in settlement evidence envelope (PROP-399 D3: MOVE_IN_SETTLED)', () => {
  const lines = [
    { kind: 'FIRST_RENT' as const, amount: 30_000_000, paymentId: 'pay-2' },
    { kind: 'DEPOSIT_TOPUP' as const, amount: 14_000_000, paymentId: 'pay-1' },
  ]

  it('sorts lines deterministically and is independent of input key order (key ordering, hash determinism)', () => {
    const first = buildMoveInSettlementEvidenceEnvelope({
      settlementId: 'settle-1',
      contractId: 'c1',
      statementHash: 'a'.repeat(64),
      lines,
      total: 44_000_000,
      paidAt: '2030-02-05T00:00:00.000Z',
    })
    const reordered = buildMoveInSettlementEvidenceEnvelope({
      total: 44_000_000,
      lines: [...lines].reverse(),
      paidAt: '2030-02-05T00:00:00.000Z',
      settlementId: 'settle-1',
      contractId: 'c1',
      statementHash: 'a'.repeat(64),
    })
    expect(first.lines).toEqual([
      { kind: 'DEPOSIT_TOPUP', amount: 14_000_000, paymentId: 'pay-1' },
      { kind: 'FIRST_RENT', amount: 30_000_000, paymentId: 'pay-2' },
    ])
    expect(hashMoveInSettlementEvidenceEnvelope(first)).toBe(
      hashMoveInSettlementEvidenceEnvelope(reordered)
    )
    expect(hashMoveInSettlementEvidenceEnvelope(first)).toMatch(
      /^[a-f0-9]{64}$/
    )
  })

  it('rejects missing required fields', () => {
    expect(() =>
      buildMoveInSettlementEvidenceEnvelope({
        settlementId: '',
        contractId: 'c1',
        statementHash: 'a'.repeat(64),
        lines,
        total: 44_000_000,
        paidAt: '2030-02-05T00:00:00.000Z',
      })
    ).toThrow('MOVE_IN_SETTLEMENT_EVIDENCE_SETTLEMENT_ID_REQUIRED')
    expect(() =>
      buildMoveInSettlementEvidenceEnvelope({
        settlementId: 'settle-1',
        contractId: 'c1',
        statementHash: 'a'.repeat(64),
        lines: [],
        total: 0,
        paidAt: '2030-02-05T00:00:00.000Z',
      })
    ).toThrow('MOVE_IN_SETTLEMENT_EVIDENCE_LINES_REQUIRED')
  })

  it('rejects an invalid statementHash or a non-finite total', () => {
    expect(() =>
      buildMoveInSettlementEvidenceEnvelope({
        settlementId: 'settle-1',
        contractId: 'c1',
        statementHash: 'not-a-hash',
        lines,
        total: 44_000_000,
        paidAt: '2030-02-05T00:00:00.000Z',
      })
    ).toThrow('MOVE_IN_SETTLEMENT_EVIDENCE_HASH_INVALID')
    expect(() =>
      buildMoveInSettlementEvidenceEnvelope({
        settlementId: 'settle-1',
        contractId: 'c1',
        statementHash: 'a'.repeat(64),
        lines,
        total: -1,
        paidAt: '2030-02-05T00:00:00.000Z',
      })
    ).toThrow('MOVE_IN_SETTLEMENT_EVIDENCE_TOTAL_INVALID')
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
    ]) {
      expect(() =>
        buildMoveInSettlementEvidenceEnvelope({
          settlementId: 'settle-1',
          contractId: 'c1',
          statementHash: 'a'.repeat(64),
          lines,
          total: 44_000_000,
          paidAt: '2030-02-05T00:00:00.000Z',
          [forbiddenField]: 'should never be here',
        })
      ).toThrow('MOVE_IN_SETTLEMENT_EVIDENCE_FORBIDDEN_FIELD')
    }
  })
})
