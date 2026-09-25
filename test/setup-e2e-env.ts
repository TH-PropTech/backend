process.env.NODE_ENV ??= 'test'
process.env.APP_PORT ??= '3001'
process.env.APP_CORS_ORIGINS ??= 'http://localhost:3000'
process.env.DATABASE_LOGGING ??= 'false'
process.env.DATABASE_SYNCHRONIZE ??= 'false'
process.env.DATABASE_URL ??= 'mongodb://localhost:27017/th_proptech_test'
process.env.EKYC_SERVICE_URL ??= 'https://ekyc.example.com'
// KYC — test-only dummy key (64 hex chars = 32-byte AES-256 key)
process.env.KYC_MEDIA_ENCRYPTION_KEY ??=
  '0000000000000000000000000000000000000000000000000000000000000000'
process.env.KYC_PRIVATE_MEDIA_DIR ??= '.data/kyc-test'
