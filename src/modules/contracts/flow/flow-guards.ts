import type { DepositAgreementStatus } from '../schemas/deposit-agreement.schema'
import type { DepositStatementStatus } from '../../rental/schemas/deposit-settlement-statement.schema'
import type { MoveOutHandoverStatus } from '../../rental/schemas/move-out-handover.schema'

/**
 * Điều kiện dùng chung giữa khối `flow` của Contract View và các endpoint
 * thực thi. Mã lý do trùng với mã lỗi endpoint trả, để "hành động được bật
 * thì endpoint chấp nhận" (spec rental-flow-state-projection).
 */
export type GuardResult = {
  enabled: boolean
  reasonCode: string | null
}

export type ExecutionStrategy = 'SIGN_FIRST'

const ALLOWED: GuardResult = { enabled: true, reasonCode: null }
const deny = (reasonCode: string): GuardResult => ({
  enabled: false,
  reasonCode,
})

const CLOSED_AGREEMENT_STATUSES: ReadonlySet<DepositAgreementStatus> = new Set([
  'cancelled',
  'expired',
  'refunded',
])
const PAID_AGREEMENT_STATUSES: ReadonlySet<DepositAgreementStatus> = new Set([
  'paid',
  'applied-to-lease-security',
  'released',
])
const PAYABLE_AGREEMENT_STATUSES: ReadonlySet<DepositAgreementStatus> = new Set(
  ['accepted', 'payment-pending']
)
const CONTENT_CLOSED_CONTRACT_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'terminated',
  'completed',
  'cancelled',
])

export function evaluateConsentDeposit(
  agreement: {
    status: DepositAgreementStatus
    contentRevision: number | null
    contentHash: string | null
  } | null
): GuardResult {
  if (!agreement) return deny('DEPOSIT_AGREEMENT_MISSING')
  if (CLOSED_AGREEMENT_STATUSES.has(agreement.status)) {
    return deny('DEPOSIT_CONSENT_CLOSED')
  }
  if (agreement.status !== 'draft') {
    return deny('DEPOSIT_CONSENT_ALREADY_GIVEN')
  }
  if (agreement.contentRevision === null || !agreement.contentHash) {
    return deny('DEPOSIT_AGREEMENT_METADATA_MISSING')
  }
  return ALLOWED
}

export function evaluatePayDeposit(
  agreement: { status: DepositAgreementStatus; hasConsent: boolean } | null
): GuardResult {
  if (!agreement) return deny('DEPOSIT_AGREEMENT_MISSING')
  if (PAID_AGREEMENT_STATUSES.has(agreement.status)) {
    return deny('DEPOSIT_ALREADY_PAID')
  }
  if (CLOSED_AGREEMENT_STATUSES.has(agreement.status)) {
    return deny('DEPOSIT_AGREEMENT_CLOSED')
  }
  if (
    !agreement.hasConsent ||
    !PAYABLE_AGREEMENT_STATUSES.has(agreement.status)
  ) {
    return deny('DEPOSIT_NOT_READY')
  }
  return ALLOWED
}

export function evaluateLockContent(input: {
  contractStatus: string | undefined
  isContentLocked: boolean
}): GuardResult {
  if (input.isContentLocked) return deny('CONTENT_ALREADY_LOCKED')
  if (CONTENT_CLOSED_CONTRACT_STATUSES.has(input.contractStatus ?? '')) {
    return deny('CONTRACT_CONTENT_STATE_CLOSED')
  }
  return ALLOWED
}

export function evaluateLockArtifact(input: {
  isContentLocked: boolean
  hasArtifact: boolean
}): GuardResult {
  if (!input.isContentLocked) return deny('CONTRACT_CONTENT_NOT_LOCKED')
  if (input.hasArtifact) return deny('ARTIFACT_ALREADY_LOCKED')
  return ALLOWED
}

export type SigningGuardInput = {
  isParticipant: boolean
  hasSigned: boolean
  isConfigOutdated: boolean
  isContentLocked: boolean
  /** true với hợp đồng SmartCA: digest ký là artifact PDF đã khóa. */
  requiresArtifact: boolean
  hasArtifact: boolean
  contractStatus: string
  isKycVerified: boolean
}

export type SigningGuardResult = {
  eligible: boolean
  reasonCode: string | null
  message: string | null
}

const blockSigning = (
  reasonCode: string,
  message: string
): SigningGuardResult => ({ eligible: false, reasonCode, message })

/** Thứ tự kiểm tra giữ nguyên `deriveSigningEligibility` trước đây. */
export function evaluateSigning(input: SigningGuardInput): SigningGuardResult {
  if (!input.isParticipant) {
    return blockSigning(
      'NOT_PARTICIPANT',
      'Bạn không phải bên ký kết của hợp đồng này.'
    )
  }
  if (input.hasSigned) {
    return blockSigning(
      'ALREADY_SIGNED',
      'Bạn đã hoàn tất xác nhận điện tử hợp đồng này.'
    )
  }
  if (input.isConfigOutdated) {
    return blockSigning(
      'CONFIG_OUTDATED',
      'Cấu hình hợp đồng đã thay đổi, cần đối soát trước khi ký.'
    )
  }
  if (!input.isContentLocked) {
    return blockSigning(
      'CONTENT_NOT_LOCKED',
      'Nội dung hợp đồng chưa được khóa để ký.'
    )
  }
  if (input.requiresArtifact && !input.hasArtifact) {
    return blockSigning(
      'ARTIFACT_NOT_LOCKED',
      'Bản PDF hợp đồng chưa được khóa để ký số.'
    )
  }
  if (input.contractStatus !== 'awaiting-signature') {
    return blockSigning(
      'WRONG_STATE',
      'Hợp đồng chưa sẵn sàng để ký kết (cần chờ duyệt hoặc hoàn tất đặt cọc).'
    )
  }
  if (!input.isKycVerified) {
    return blockSigning(
      'KYC_NOT_VERIFIED',
      'Tài khoản chưa hoàn tất định danh điện tử (KYC).'
    )
  }
  return { eligible: true, reasonCode: null, message: null }
}

// ── Kết thúc thuê (move-out): mã lý do trùng mã lỗi của endpoint tương ứng ──

const REFUNDABLE_STATEMENT_STATUSES: ReadonlySet<DepositStatementStatus> =
  new Set(['accepted', 'disputed', 'refund-recorded'])

/** Chủ nhà ghi biên bản lần đầu hoặc sửa (revision mới) khi biên bản còn mở. */
export function evaluateRecordMoveOutHandover(
  handover: MoveOutHandoverStatus | null
): GuardResult {
  if (handover === 'completed') {
    return deny('MOVE_OUT_HANDOVER_COMPLETED_IMMUTABLE')
  }
  if (handover === 'disputed') return deny('MOVE_OUT_HANDOVER_DISPUTED')
  return ALLOWED
}

/** Khách xác nhận hoặc nêu sai lệch: cần biên bản đang `recorded`. */
export function evaluateRespondMoveOutHandover(
  handover: MoveOutHandoverStatus | null
): GuardResult {
  if (handover === null) return deny('MOVE_OUT_HANDOVER_NOT_FOUND')
  return evaluateRecordMoveOutHandover(handover)
}

export function evaluateCreateDepositStatement(
  handover: MoveOutHandoverStatus | null,
  statement: DepositStatementStatus | null
): GuardResult {
  if (handover !== 'completed') {
    return deny('MOVE_OUT_HANDOVER_NOT_COMPLETED')
  }
  if (statement !== null && statement !== 'draft') {
    return deny('STATEMENT_NOT_DRAFT')
  }
  return ALLOWED
}

export function evaluateRespondDepositStatement(
  statement: DepositStatementStatus | null
): GuardResult {
  return statement === 'awaiting-tenant'
    ? ALLOWED
    : deny('STATEMENT_NOT_AWAITING_TENANT')
}

export function evaluateRecordDepositRefund(
  statement: DepositStatementStatus | null
): GuardResult {
  return statement !== null && REFUNDABLE_STATEMENT_STATUSES.has(statement)
    ? ALLOWED
    : deny('STATEMENT_REFUND_NOT_ALLOWED')
}

export function evaluateAcknowledgeDepositRefund(
  hasUnacknowledgedRefund: boolean
): GuardResult {
  return hasUnacknowledgedRefund
    ? ALLOWED
    : deny('STATEMENT_NO_REFUND_TO_ACKNOWLEDGE')
}
