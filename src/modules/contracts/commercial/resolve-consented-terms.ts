import type {
  ConsentedContractTerms,
  Contract,
} from '../schemas/contract.schema'

/** Trường thương mại chỉ đổi khi khách đồng ý (không admin nào được ghi đè trực tiếp). */
export const CONSENT_REQUIRED_FIELDS = [
  'monthlyRent',
  'deposit',
  'durationMonths',
] as const

/**
 * Giá, cọc, kỳ hạn mà khách đã chấp thuận: giá trị đã đồng ý qua yêu cầu chỉnh sửa,
 * nếu chưa có thì lấy từ gói thuê khách đã nộp đơn. Hợp đồng không có gói thuê
 * (tạo tay) trả `null`, nghĩa là chưa có mốc để so sánh.
 */
export function resolveConsentedTerms(
  contract: Pick<Contract, 'consentedTerms' | 'packageSnapshot'>
): ConsentedContractTerms | null {
  if (contract.consentedTerms) return contract.consentedTerms
  const snapshot = contract.packageSnapshot
  if (!snapshot) return null
  return {
    monthlyRent: snapshot.monthlyRent,
    deposit: snapshot.resolvedDepositAmount,
    durationMonths: snapshot.durationMonths,
  }
}
