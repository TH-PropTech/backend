/**
 * PROP-399 D5: tiện ích thuần cho FabricService — giải mã qscc GetChainInfo (hằng chi phí),
 * phân loại lỗi connection-level so với business-level, và ánh xạ mã commit status.
 */

export type BlockchainInfo = {
  height: number | null
  currentBlockHash: string | null
}

const EMPTY_INFO: BlockchainInfo = { height: null, currentBlockHash: null }

function readVarint(
  bytes: Uint8Array,
  start: number
): { value: bigint; next: number } | null {
  let value = 0n
  let shift = 0n
  let index = start
  while (index < bytes.length) {
    const byte = bytes[index] as number
    value |= BigInt(byte & 0x7f) << shift
    index += 1
    if ((byte & 0x80) === 0) return { value, next: index }
    shift += 7n
    if (shift > 63n) return null
  }
  return null
}

/**
 * Giải mã protobuf `common.BlockchainInfo` (height=1 varint, currentBlockHash=2 bytes,
 * previousBlockHash=3 bytes) mà không cần thư viện protobuf. Dữ liệu hỏng → giá trị null.
 */
export function decodeBlockchainInfo(bytes: Uint8Array): BlockchainInfo {
  let height: bigint | null = null
  let currentBlockHash: string | null = null
  let index = 0

  while (index < bytes.length) {
    const tag = readVarint(bytes, index)
    if (!tag) return EMPTY_INFO
    index = tag.next
    const field = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 7n)

    if (wireType === 0) {
      const value = readVarint(bytes, index)
      if (!value) return EMPTY_INFO
      index = value.next
      if (field === 1) height = value.value
    } else if (wireType === 2) {
      const length = readVarint(bytes, index)
      if (!length) return EMPTY_INFO
      const end = length.next + Number(length.value)
      if (end > bytes.length) return EMPTY_INFO
      if (field === 2) {
        currentBlockHash = Buffer.from(
          bytes.subarray(length.next, end)
        ).toString('hex')
      }
      index = end
    } else {
      return EMPTY_INFO
    }
  }

  return {
    height:
      height === null && currentBlockHash === null
        ? null
        : toSafeBlockNumber(height ?? 0n, true),
    currentBlockHash,
  }
}

/** bigint/number → số nguyên an toàn; `allowZero` chỉ dùng cho chiều cao chuỗi. */
export function toSafeBlockNumber(
  value: unknown,
  allowZero = false
): number | null {
  const big =
    typeof value === 'bigint'
      ? value
      : typeof value === 'number' && Number.isInteger(value)
        ? BigInt(value)
        : null
  if (big === null) return null
  if (big < (allowZero ? 0n : 1n)) return null
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(big)
}

export type FabricErrorClass = 'connection' | 'business'

const BUSINESS_CODE = /\bERR_[A-Z][A-Z_]*:/
const GRPC_CONNECTION_CODES = new Set([4, 14])
const GRPC_CONNECTION_NAMES = new Set(['UNAVAILABLE', 'DEADLINE_EXCEEDED'])
const CONNECTION_MESSAGE =
  /\b(UNAVAILABLE|DEADLINE_EXCEEDED|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT)\b|handshake|certificate|\bTLS\b|\bSSL\b|x509|no endorsement plan|failed to select|discovery/i

/**
 * Lỗi connection-level (đóng + dựng lại gateway) vs business-level (mã ERR_<CODE> của chaincode,
 * không reconnect). Mã ERR_ của chaincode luôn thắng các từ khoá truyền tải.
 */
export function classifyFabricError(error: unknown): FabricErrorClass {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  if (BUSINESS_CODE.test(message)) return 'business'

  const code =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined
  if (typeof code === 'number' && GRPC_CONNECTION_CODES.has(code)) {
    return 'connection'
  }
  if (typeof code === 'string' && GRPC_CONNECTION_NAMES.has(code)) {
    return 'connection'
  }
  return CONNECTION_MESSAGE.test(message) ? 'connection' : 'business'
}

const COMMIT_STATUS_NAMES: Record<number, string> = {
  1: 'NIL_ENVELOPE',
  2: 'BAD_PAYLOAD',
  3: 'BAD_COMMON_HEADER',
  4: 'BAD_CREATOR_SIGNATURE',
  5: 'INVALID_ENDORSER_TRANSACTION',
  6: 'INVALID_CONFIG_TRANSACTION',
  7: 'UNSUPPORTED_TX_PAYLOAD',
  8: 'BAD_PROPOSAL_TXID',
  9: 'DUPLICATE_TXID',
  10: 'ENDORSEMENT_POLICY_FAILURE',
  11: 'MVCC_READ_CONFLICT',
  12: 'PHANTOM_READ_CONFLICT',
  13: 'UNKNOWN_TX_TYPE',
  14: 'TARGET_CHAIN_NOT_FOUND',
  15: 'MARSHAL_TX_ERROR',
  16: 'NIL_TXACTION',
  17: 'EXPIRED_CHAINCODE',
  18: 'CHAINCODE_VERSION_CONFLICT',
  19: 'BAD_HEADER_EXTENSION',
  20: 'BAD_CHANNEL_HEADER',
  21: 'BAD_RESPONSE_PAYLOAD',
  22: 'BAD_RWSET',
  23: 'ILLEGAL_WRITESET',
  24: 'INVALID_WRITESET',
  25: 'INVALID_CHAINCODE',
  254: 'NOT_VALIDATED',
  255: 'INVALID_OTHER_REASON',
}

// Các mã mà thử lại sau (outbox backoff) có thể thành công: xung đột đọc/ghi, chaincode đang nâng cấp.
const RETRYABLE_COMMIT_CODES = new Set([11, 12, 17, 254])

export function classifyCommitStatus(code: number): {
  code: number
  name: string
  kind: 'retryable' | 'terminal'
} {
  return {
    code,
    name: COMMIT_STATUS_NAMES[code] ?? 'UNKNOWN',
    kind: RETRYABLE_COMMIT_CODES.has(code) ? 'retryable' : 'terminal',
  }
}
