import { isSha256 } from './canonical-json'

/**
 * PROP-399 D12: mọi action mà outbox được phép submit/retry. Action ngoài
 * danh sách này bị fail terminal mà không submit.
 */
export const LEDGER_SUBMIT_ACTIONS: ReadonlySet<string> = new Set([
  'recordDeposit',
  'createContract',
  'recordPayment',
  'recordContractAmendment',
  'terminateContract',
  'publishGovernanceSnapshot',
  'recordMoveInSettlement',
  'recordHandover',
])

const ISO_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function isPositiveIntegerString(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
}

function isIsoTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_TIME.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function positiveInt(value: number): string | null {
  return Number.isInteger(value) && value >= 1 ? String(value) : null
}

function invalid(action: string, reason: string): never {
  throw new Error(`LEDGER_ARGS_INVALID: ${action}: ${reason}`)
}

export type GovernanceSnapshotArgsInput = {
  snapshotId: string
  version: number
  manifestHash: string
  manifestSchemaVersion: number
}

/** Args cho chaincode `publishGovernanceSnapshot` — chỉ metadata an toàn riêng tư. */
export function buildGovernanceSnapshotArgs(
  input: GovernanceSnapshotArgsInput
): string[] {
  const action = 'publishGovernanceSnapshot'
  const version = positiveInt(input.version)
  const schemaVersion = positiveInt(input.manifestSchemaVersion)
  if (!isNonEmpty(input.snapshotId)) invalid(action, 'snapshotId required')
  if (!version) invalid(action, 'version must be a positive integer')
  if (!isSha256(input.manifestHash)) invalid(action, 'manifestHash invalid')
  if (!schemaVersion) {
    invalid(action, 'manifestSchemaVersion must be a positive integer')
  }
  return [input.snapshotId, version, input.manifestHash, schemaVersion]
}

export type MoveInSettlementArgsInput = {
  settlementId: string
  contractId: string
  manifestHash: string
  manifestSchemaVersion: number
  occurredAt: string
}

/** Args cho chaincode `recordMoveInSettlement(settlementId, contractId, manifestHash, schemaVersion, occurredAt)`. */
export function buildMoveInSettlementArgs(
  input: MoveInSettlementArgsInput
): string[] {
  const action = 'recordMoveInSettlement'
  const schemaVersion = positiveInt(input.manifestSchemaVersion)
  if (!isNonEmpty(input.settlementId)) invalid(action, 'settlementId required')
  if (!isNonEmpty(input.contractId)) invalid(action, 'contractId required')
  if (!isSha256(input.manifestHash)) invalid(action, 'manifestHash invalid')
  if (!schemaVersion) {
    invalid(action, 'manifestSchemaVersion must be a positive integer')
  }
  if (!isIsoTime(input.occurredAt)) invalid(action, 'occurredAt must be ISO')
  return [
    input.settlementId,
    input.contractId,
    input.manifestHash,
    schemaVersion,
    input.occurredAt,
  ]
}

export type HandoverArgsInput = {
  settlementId: string
  contractId: string
  handoverHash: string
  manifestSchemaVersion: number
  revision: number
  overrideUsed: boolean
  occurredAt: string
}

/** Args cho chaincode `recordHandover(...)`; chỉ `overrideUsed` boolean, không có lý do override. */
export function buildHandoverArgs(input: HandoverArgsInput): string[] {
  const action = 'recordHandover'
  const schemaVersion = positiveInt(input.manifestSchemaVersion)
  const revision = positiveInt(input.revision)
  if (!isNonEmpty(input.settlementId)) invalid(action, 'settlementId required')
  if (!isNonEmpty(input.contractId)) invalid(action, 'contractId required')
  if (!isSha256(input.handoverHash)) invalid(action, 'handoverHash invalid')
  if (!schemaVersion) {
    invalid(action, 'manifestSchemaVersion must be a positive integer')
  }
  if (!revision) invalid(action, 'revision must be a positive integer')
  if (typeof input.overrideUsed !== 'boolean') {
    invalid(action, 'overrideUsed must be a boolean')
  }
  if (!isIsoTime(input.occurredAt)) invalid(action, 'occurredAt must be ISO')
  return [
    input.settlementId,
    input.contractId,
    input.handoverHash,
    schemaVersion,
    revision,
    input.overrideUsed ? 'true' : 'false',
    input.occurredAt,
  ]
}

/**
 * Kiểm tra args đã lưu trong outbox ngay trước khi submit. Chỉ ràng buộc 3
 * action mới của PROP-399; action cũ do chaincode validate như trước.
 * Trả về lý do lỗi, hoặc `null` nếu hợp lệ.
 */
export function validateLedgerActionArgs(
  action: string,
  args: unknown
): string | null {
  const list = Array.isArray(args) ? (args as unknown[]) : null
  switch (action) {
    case 'publishGovernanceSnapshot': {
      if (!list || list.length !== 4) return 'arity must be 4'
      const [snapshotId, version, manifestHash, schemaVersion] = list
      if (!isNonEmpty(snapshotId)) return 'snapshotId required'
      if (!isPositiveIntegerString(version))
        return 'version must be a positive integer'
      if (!isSha256(manifestHash)) return 'manifestHash must be a SHA-256 hash'
      if (!isPositiveIntegerString(schemaVersion)) {
        return 'manifestSchemaVersion must be a positive integer'
      }
      return null
    }
    case 'recordMoveInSettlement': {
      if (!list || list.length !== 5) return 'arity must be 5'
      const [
        settlementId,
        contractId,
        manifestHash,
        schemaVersion,
        occurredAt,
      ] = list
      if (!isNonEmpty(settlementId) || !isNonEmpty(contractId)) {
        return 'settlementId and contractId required'
      }
      if (!isSha256(manifestHash)) return 'manifestHash must be a SHA-256 hash'
      if (!isPositiveIntegerString(schemaVersion)) {
        return 'manifestSchemaVersion must be a positive integer'
      }
      if (!isIsoTime(occurredAt)) return 'occurredAt must be an ISO time'
      return null
    }
    case 'recordHandover': {
      if (!list || list.length !== 7) return 'arity must be 7'
      const [
        settlementId,
        contractId,
        handoverHash,
        schemaVersion,
        revision,
        overrideUsed,
        occurredAt,
      ] = list
      if (!isNonEmpty(settlementId) || !isNonEmpty(contractId)) {
        return 'settlementId and contractId required'
      }
      if (!isSha256(handoverHash)) return 'handoverHash must be a SHA-256 hash'
      if (!isPositiveIntegerString(schemaVersion)) {
        return 'manifestSchemaVersion must be a positive integer'
      }
      if (!isPositiveIntegerString(revision)) {
        return 'revision must be a positive integer'
      }
      if (overrideUsed !== 'true' && overrideUsed !== 'false') {
        return 'overrideUsed must be a boolean string'
      }
      if (!isIsoTime(occurredAt)) return 'occurredAt must be an ISO time'
      return null
    }
    default:
      return null
  }
}
