/**
 * Dev/test only: bật khi ENABLE_TEST_SIGN_BYPASS=true và KHÔNG phải production.
 * Cho phép ký bỏ qua SmartCA/sinh trắc/Smart OTP (và không đòi KYC) để chạy tiếp các bước sau.
 */
export function isTestSignBypassEnabled(): boolean {
  return (
    process.env['NODE_ENV'] !== 'production' &&
    process.env['ENABLE_TEST_SIGN_BYPASS'] === 'true'
  )
}
