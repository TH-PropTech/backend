import type { DepositAgreementStatus } from '../schemas/deposit-agreement.schema'

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
