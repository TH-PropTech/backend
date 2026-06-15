import { registerAs } from '@nestjs/config';

export default registerAs('smartCA', () => {
  const env = (process.env.SMARTCA_ENV || 'production').toLowerCase();
  const isTest = env === 'test';

  return {
    // Active environment label
    environment: isTest ? 'test' : 'production',

    // VNPT SmartCA API base URL
    // Test: https://rmgateway.vnptit.vn  |  Prod: https://gwsca.vnpt.vn
    apiUrl: isTest
      ? process.env.SMARTCA_TEST_API_URL || 'https://rmgateway.vnptit.vn'
      : process.env.SMARTCA_API_URL || 'https://gwsca.vnpt.vn',

    // Service Partner credentials (sent in request body as sp_id / sp_password)
    spId: isTest ? process.env.SMARTCA_TEST_SP_ID || '' : process.env.SMARTCA_SP_ID || '',
    spPassword: isTest ? process.env.SMARTCA_TEST_SP_PASSWORD || '' : process.env.SMARTCA_SP_PASSWORD || '',
    mobileCode: isTest ? process.env.SMARTCA_TEST_MOBILE_CODE || '' : process.env.SMARTCA_MOBILE_CODE || '',

    // Default user_id (CCCD) - taken from user's KYC in production
    defaultUserId: isTest ? process.env.SMARTCA_TEST_DEFAULT_USER_ID || '' : process.env.SMARTCA_DEFAULT_USER_ID || '',

    // API paths
    certPath: isTest
      ? process.env.SMARTCA_TEST_CERT_PATH || '/sca/sp769/v1/credentials/get_certificate'
      : process.env.SMARTCA_CERT_PATH || '/sca/sp769/v1/credentials/get_certificate',
    signV1Path: isTest
      ? process.env.SMARTCA_TEST_SIGN_V1_PATH || '/sca/sp769/v1/signatures/sign'
      : process.env.SMARTCA_SIGN_V1_PATH || '/sca/sp769/v1/signatures/sign',
    signV2Path: isTest
      ? process.env.SMARTCA_TEST_SIGN_V2_PATH || '/sca/sp769/v2/signatures/sign'
      : process.env.SMARTCA_SIGN_V2_PATH || '/sca/sp769/v2/signatures/sign',
    confirmV2Path: isTest
      ? process.env.SMARTCA_TEST_CONFIRM_V2_PATH || '/sca/sp769/v2/signatures/confirm'
      : process.env.SMARTCA_CONFIRM_V2_PATH || '/sca/sp769/v2/signatures/confirm',
    statusPathTmpl: isTest
      ? process.env.SMARTCA_TEST_STATUS_PATH_TMPL || '/sca/sp769/v1/signatures/sign/{transactionId}/status'
      : process.env.SMARTCA_STATUS_PATH_TMPL || '/sca/sp769/v1/signatures/sign/{transactionId}/status',

    // Timeouts
    signingTimeoutMs: parseInt(process.env.SMARTCA_SIGNING_TIMEOUT_MS || '300000', 10),
    pollingIntervalMs: parseInt(process.env.SMARTCA_POLLING_INTERVAL_MS || '3000', 10),
  };
});