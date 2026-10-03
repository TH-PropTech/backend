import {
  classifyCommitStatus,
  classifyFabricError,
  decodeBlockchainInfo,
  toSafeBlockNumber,
} from './fabric-gateway-utils'

function varint(value: bigint): number[] {
  const bytes: number[] = []
  let rest = value
  do {
    let byte = Number(rest & 0x7fn)
    rest >>= 7n
    if (rest > 0n) byte |= 0x80
    bytes.push(byte)
  } while (rest > 0n)
  return bytes
}

function blockchainInfo(
  height: bigint,
  current: number[],
  previous: number[]
): Uint8Array {
  return Uint8Array.from([
    0x08,
    ...varint(height),
    0x12,
    ...varint(BigInt(current.length)),
    ...current,
    0x1a,
    ...varint(BigInt(previous.length)),
    ...previous,
  ])
}

describe('decodeBlockchainInfo (qscc GetChainInfo, constant cost)', () => {
  it('decodes height and the current block hash as hex', () => {
    const hash = Array.from({ length: 32 }, (_, i) => i)
    expect(decodeBlockchainInfo(blockchainInfo(1234n, hash, [9, 9]))).toEqual({
      height: 1234,
      currentBlockHash: hash.map(b => b.toString(16).padStart(2, '0')).join(''),
    })
  })

  it('handles multi-byte varints and a height of zero', () => {
    expect(decodeBlockchainInfo(blockchainInfo(300n, [1], [])).height).toBe(300)
    expect(decodeBlockchainInfo(Uint8Array.from([0x12, 1, 0xab]))).toEqual({
      height: 0,
      currentBlockHash: 'ab',
    })
  })

  it('returns nulls for a height beyond the safe integer range', () => {
    expect(
      decodeBlockchainInfo(blockchainInfo(2n ** 60n, [1], [])).height
    ).toBeNull()
  })

  it.each([
    ['empty', Uint8Array.from([])],
    ['json garbage', Buffer.from('[]')],
    ['truncated length-delimited field', Uint8Array.from([0x12, 5, 1])],
    ['unterminated varint', Uint8Array.from([0x08, 0x80])],
  ])('never throws on %s and reports unknown values', (_label, bytes) => {
    expect(decodeBlockchainInfo(bytes)).toEqual({
      height: null,
      currentBlockHash: null,
    })
  })
})

describe('classifyFabricError (D5 self-healing gateway)', () => {
  it.each([
    [new Error('14 UNAVAILABLE: No connection established')],
    [new Error('4 DEADLINE_EXCEEDED: Deadline exceeded')],
    [new Error('connect ECONNREFUSED 127.0.0.1:7051')],
    [new Error('read ECONNRESET')],
    [new Error('SSL routines: tlsv1 alert unknown ca (handshake failure)')],
    [new Error('x509: certificate has expired or is not yet valid')],
    [new Error('failed to select a peer: no endorsement plan available')],
    [new Error('discovery service failed to return results')],
    [Object.assign(new Error('boom'), { code: 14 })],
    [Object.assign(new Error('boom'), { code: 4 })],
    [Object.assign(new Error('boom'), { code: 'UNAVAILABLE' })],
  ])('classifies %p as connection-level', error => {
    expect(classifyFabricError(error)).toBe('connection')
  })

  it.each([
    [new Error('10 ABORTED: ... Error: ERR_CONFLICT: payload differs')],
    [new Error('Fabric transaction failed: ERR_FORBIDDEN: not permitted')],
    [new Error('ERR_SCHEMA: invalid')],
    // Business code wins even when the message also mentions a transport word.
    [new Error('ERR_NOT_FOUND: certificate for contract does not exist')],
    [new Error('some other validation failure')],
    [Object.assign(new Error('ERR_CONFLICT: x'), { code: 14 })],
  ])('classifies %p as business-level (no reconnect)', error => {
    expect(classifyFabricError(error)).toBe('business')
  })

  it('handles non-Error values', () => {
    expect(classifyFabricError('14 UNAVAILABLE')).toBe('connection')
    expect(classifyFabricError(undefined)).toBe('business')
  })
})

describe('classifyCommitStatus', () => {
  it.each([
    [11, 'MVCC_READ_CONFLICT', 'retryable'],
    [12, 'PHANTOM_READ_CONFLICT', 'retryable'],
    [17, 'EXPIRED_CHAINCODE', 'retryable'],
    [254, 'NOT_VALIDATED', 'retryable'],
    [10, 'ENDORSEMENT_POLICY_FAILURE', 'terminal'],
    [2, 'BAD_PAYLOAD', 'terminal'],
    [9, 'DUPLICATE_TXID', 'terminal'],
    [255, 'INVALID_OTHER_REASON', 'terminal'],
    [999, 'UNKNOWN', 'terminal'],
  ])('maps code %i (%s) to %s', (code, name, kind) => {
    expect(classifyCommitStatus(code)).toEqual({ code, name, kind })
  })
})

describe('toSafeBlockNumber', () => {
  it('converts bigint block numbers within the safe integer range', () => {
    expect(toSafeBlockNumber(42n)).toBe(42)
    expect(toSafeBlockNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER
    )
  })

  it('rejects zero, negatives, unsafe and non-bigint inputs with null', () => {
    expect(toSafeBlockNumber(0n)).toBeNull()
    expect(toSafeBlockNumber(-1n)).toBeNull()
    expect(toSafeBlockNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBeNull()
    expect(toSafeBlockNumber(undefined)).toBeNull()
    expect(toSafeBlockNumber(null)).toBeNull()
  })
})
