import { registerAs } from '@nestjs/config'

export default registerAs('smartCA', () => {
  const env = (process.env.SMARTCA_ENV || 'production').toLowerCase()
  const isMock = env === 'mock'
  const isTest = env === 'test'

  return {
    // Active environment label
    environment: isMock ? 'mock' : isTest ? 'test' : 'production',
    isMock,

    // VNPT SmartCA Signing API base URL
    // Test: https://rmgateway.vnptit.vn  |  Prod: https://gwsca.vnpt.vn
    apiUrl: isTest
      ? process.env.SMARTCA_TEST_API_URL || 'https://rmgateway.vnptit.vn'
      : process.env.SMARTCA_API_URL || 'https://gwsca.vnpt.vn',

    // Service Partner credentials — gửi trong body JSON (sp_id / sp_password)
    spId: isTest
      ? process.env.SMARTCA_TEST_SP_ID || ''
      : process.env.SMARTCA_SP_ID || '',
    spPassword: isTest
      ? process.env.SMARTCA_TEST_SP_PASSWORD || ''
      : process.env.SMARTCA_SP_PASSWORD || '',

    // Default user_id (số CCCD) - lấy từ KYC của user trong production
    defaultUserId: isTest
      ? process.env.SMARTCA_TEST_DEFAULT_USER_ID || ''
      : process.env.SMARTCA_DEFAULT_USER_ID || '',

    // API paths — base_url = {apiUrl}/sca/sp769
    certPath: isTest
      ? process.env.SMARTCA_TEST_CERT_PATH ||
        '/sca/sp769/v1/credentials/get_certificate'
      : process.env.SMARTCA_CERT_PATH ||
        '/sca/sp769/v1/credentials/get_certificate',
    // v1 sign (§3.3): người ký duyệt trong app VNPT SmartCA, không có password/OTP
    signPath: isTest
      ? process.env.SMARTCA_TEST_SIGN_PATH || '/sca/sp769/v1/signatures/sign'
      : process.env.SMARTCA_SIGN_PATH || '/sca/sp769/v1/signatures/sign',
    // Status API: POST (không phải GET!) — template có {transactionId}
    statusPathTmpl: isTest
      ? process.env.SMARTCA_TEST_STATUS_PATH_TMPL ||
        '/sca/sp769/v1/signatures/sign/{transactionId}/status'
      : process.env.SMARTCA_STATUS_PATH_TMPL ||
        '/sca/sp769/v1/signatures/sign/{transactionId}/status',

    // Timeouts
    signingTimeoutMs: parseInt(
      process.env.SMARTCA_SIGNING_TIMEOUT_MS || '300000',
      10
    ),
  }
})
