import {
  LEDGER_SUBMIT_ACTIONS,
  buildGovernanceSnapshotArgs,
  buildHandoverArgs,
  buildMoveInSettlementArgs,
  buildPenaltyArgs,
  fitLedgerArgsToAbi,
  validateLedgerActionArgs,
} from './ledger-action-args'

const HASH = 'a'.repeat(64)
const ISO = '2026-10-02T03:04:05.000Z'

describe('ledger-action-args (PROP-399 D12)', () => {
  it('lists every action the outbox is allowed to submit/retry', () => {
    expect([...LEDGER_SUBMIT_ACTIONS].sort()).toEqual(
      [
        'createContract',
        'publishGovernanceSnapshot',
        'recordContractAmendment',
        'recordDeposit',
        'recordHandover',
        'recordMoveInSettlement',
        'recordPayment',
        'recordPenalty',
        'terminateContract',
      ].sort()
    )
  })

  describe('buildGovernanceSnapshotArgs', () => {
    it('builds the positional args for publishGovernanceSnapshot', () => {
      expect(
        buildGovernanceSnapshotArgs({
          snapshotId: 'snap-1',
          version: 3,
          manifestHash: HASH,
          manifestSchemaVersion: 1,
        })
      ).toEqual(['snap-1', '3', HASH, '1'])
    })

    it.each([
      ['empty snapshotId', { snapshotId: '' }],
      ['non-positive version', { version: 0 }],
      ['fractional version', { version: 1.5 }],
      ['bad hash', { manifestHash: 'xyz' }],
      ['bad schema version', { manifestSchemaVersion: 0 }],
    ])('rejects %s', (_label, override) => {
      expect(() =>
        buildGovernanceSnapshotArgs({
          snapshotId: 'snap-1',
          version: 1,
          manifestHash: HASH,
          manifestSchemaVersion: 1,
          ...override,
        })
      ).toThrow('LEDGER_ARGS_INVALID')
    })
  })

  describe('buildPenaltyArgs / recordPenalty validation', () => {
    const input = {
      penaltyId: 'pen-1',
      contractId: 'c-1',
      sourcePaymentId: 'pay-1',
      baseAmount: 5000000,
      ratePerYear: 10,
      daysLate: 20,
      amount: 27397,
      penaltyHash: HASH,
    }

    it('builds the 8 positional args for recordPenalty', () => {
      const args = buildPenaltyArgs(input)
      expect(args).toEqual([
        'pen-1',
        'c-1',
        'pay-1',
        '5000000',
        '10',
        '20',
        '27397',
        HASH,
      ])
      expect(validateLedgerActionArgs('recordPenalty', args)).toBeNull()
    })

    it.each([
      ['empty penaltyId', { penaltyId: '' }],
      ['empty sourcePaymentId', { sourcePaymentId: ' ' }],
      ['zero base', { baseAmount: 0 }],
      ['fractional base', { baseAmount: 1.5 }],
      ['zero rate', { ratePerYear: 0 }],
      ['zero days', { daysLate: 0 }],
      ['negative amount', { amount: -1 }],
      ['bad hash', { penaltyHash: 'xyz' }],
    ])('rejects %s when building', (_label, override) => {
      expect(() => buildPenaltyArgs({ ...input, ...override })).toThrow(
        'LEDGER_ARGS_INVALID'
      )
    })

    it('rejects a wrong arity or malformed stored args', () => {
      const args = buildPenaltyArgs(input)
      expect(validateLedgerActionArgs('recordPenalty', args.slice(1))).toBe(
        'arity must be 8'
      )
      expect(
        validateLedgerActionArgs('recordPenalty', [
          ...args.slice(0, 7),
          'not-a-hash',
        ])
      ).toBe('penaltyHash must be a SHA-256 hash')
      expect(
        validateLedgerActionArgs('recordPenalty', [
          ...args.slice(0, 3),
          '0',
          ...args.slice(4),
        ])
      ).toBe('baseAmount must be a positive integer')
    })
  })

  describe('fitLedgerArgsToAbi (Fabric enforces the chaincode arity)', () => {
    const four = ['p', 'c', '100', HASH]

    it('adds the empty period start for a recordPayment queued before the ABI 3 upgrade', () => {
      expect(fitLedgerArgsToAbi('recordPayment', four, 3)).toEqual([
        ...four,
        '',
      ])
    })

    it('drops the period start when the chaincode is below ABI 3', () => {
      expect(
        fitLedgerArgsToAbi(
          'recordPayment',
          [...four, '2026-12-01T00:00:00.000Z'],
          2
        )
      ).toEqual(four)
    })

    it('leaves already-matching and other actions untouched', () => {
      const five = [...four, '2026-12-01T00:00:00.000Z']
      expect(fitLedgerArgsToAbi('recordPayment', five, 3)).toBe(five)
      expect(fitLedgerArgsToAbi('recordPayment', four, 2)).toBe(four)
      expect(fitLedgerArgsToAbi('recordDeposit', four, 3)).toBe(four)
    })
  })

  describe('buildMoveInSettlementArgs', () => {
    it('builds the positional args for recordMoveInSettlement', () => {
      expect(
        buildMoveInSettlementArgs({
          settlementId: 's-1',
          contractId: 'c-1',
          manifestHash: HASH,
          manifestSchemaVersion: 1,
          occurredAt: ISO,
        })
      ).toEqual(['s-1', 'c-1', HASH, '1', ISO])
    })

    it('rejects a missing contract id and a non-ISO time', () => {
      expect(() =>
        buildMoveInSettlementArgs({
          settlementId: 's-1',
          contractId: '',
          manifestHash: HASH,
          manifestSchemaVersion: 1,
          occurredAt: ISO,
        })
      ).toThrow('LEDGER_ARGS_INVALID')
      expect(() =>
        buildMoveInSettlementArgs({
          settlementId: 's-1',
          contractId: 'c-1',
          manifestHash: HASH,
          manifestSchemaVersion: 1,
          occurredAt: 'yesterday',
        })
      ).toThrow('LEDGER_ARGS_INVALID')
    })
  })

  describe('buildHandoverArgs', () => {
    it('builds the positional args for recordHandover with overrideUsed as a string flag', () => {
      expect(
        buildHandoverArgs({
          settlementId: 's-1',
          contractId: 'c-1',
          handoverHash: HASH,
          manifestSchemaVersion: 1,
          revision: 1,
          overrideUsed: false,
          occurredAt: ISO,
        })
      ).toEqual(['s-1', 'c-1', HASH, '1', '1', 'false', ISO])
      expect(
        buildHandoverArgs({
          settlementId: 's-1',
          contractId: 'c-1',
          handoverHash: HASH,
          manifestSchemaVersion: 1,
          revision: 2,
          overrideUsed: true,
          occurredAt: ISO,
        })[5]
      ).toBe('true')
    })

    it('rejects an invalid revision', () => {
      expect(() =>
        buildHandoverArgs({
          settlementId: 's-1',
          contractId: 'c-1',
          handoverHash: HASH,
          manifestSchemaVersion: 1,
          revision: 0,
          overrideUsed: false,
          occurredAt: ISO,
        })
      ).toThrow('LEDGER_ARGS_INVALID')
    })
  })

  describe('validateLedgerActionArgs', () => {
    it('accepts args produced by the builders', () => {
      expect(
        validateLedgerActionArgs('publishGovernanceSnapshot', [
          'snap-1',
          '1',
          HASH,
          '1',
        ])
      ).toBeNull()
      expect(
        validateLedgerActionArgs('recordMoveInSettlement', [
          's-1',
          'c-1',
          HASH,
          '1',
          ISO,
        ])
      ).toBeNull()
      expect(
        validateLedgerActionArgs('recordHandover', [
          's-1',
          'c-1',
          HASH,
          '1',
          '1',
          'true',
          ISO,
        ])
      ).toBeNull()
    })

    it('reports a reason for wrong arity, bad hashes, bad numbers and bad flags', () => {
      expect(
        validateLedgerActionArgs('publishGovernanceSnapshot', ['snap-1'])
      ).toMatch(/arity/)
      expect(
        validateLedgerActionArgs('publishGovernanceSnapshot', [
          'snap-1',
          '1',
          'nothash',
          '1',
        ])
      ).toMatch(/hash/i)
      expect(
        validateLedgerActionArgs('recordHandover', [
          's-1',
          'c-1',
          HASH,
          '1',
          'x',
          'true',
          ISO,
        ])
      ).toMatch(/integer/i)
      expect(
        validateLedgerActionArgs('recordHandover', [
          's-1',
          'c-1',
          HASH,
          '1',
          '1',
          'maybe',
          ISO,
        ])
      ).toMatch(/boolean/i)
    })

    it('does not constrain legacy actions (their args are validated by chaincode)', () => {
      expect(validateLedgerActionArgs('createContract', ['c-1'])).toBeNull()
      expect(validateLedgerActionArgs('recordPayment', [])).toBeNull()
    })
  })
})
