/**
 * Dev/test only: bật khi KYC_SKIP_SELFIE=true và KHÔNG phải production.
 * Cho phép nộp hồ sơ KYC chỉ với ảnh CCCD (bỏ bước selfie + liveness). Production luôn bắt buộc selfie.
 */
export function isKycSelfieOptional(): boolean {
  return (
    process.env['NODE_ENV'] !== 'production' &&
    process.env['KYC_SKIP_SELFIE'] === 'true'
  )
}
