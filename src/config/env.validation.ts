import Joi from 'joi'

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('local', 'development', 'test', 'staging', 'production')
    .default('local'),
  APP_PORT: Joi.number().port().default(3001),
  APP_URL: Joi.string().uri().default('http://localhost:3001'),
  APP_CORS_ORIGINS: Joi.string().default('http://localhost:3000'),
  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_LOGGING: Joi.boolean().default(false),
  DATABASE_SYNCHRONIZE: Joi.boolean().default(false),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  GROQ_API_KEY: Joi.string().allow('').optional(),
  RECOMMENDATION_API_URL: Joi.string().allow('').optional(),
  EKYC_SERVICE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  THEKYC_SERVICE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),
  EKYC_REQUEST_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(120000)
    .default(60000),
  KYC_MEDIA_ENCRYPTION_KEY: Joi.string().hex().length(64).when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  KYC_PRIVATE_MEDIA_DIR: Joi.string().default('.data/kyc'),
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').optional(),
  CLOUDINARY_API_KEY: Joi.string().allow('').optional(),
  CLOUDINARY_API_SECRET: Joi.string().allow('').optional(),
  RENTAL_FLOW_V4_ENABLED: Joi.boolean().default(false),
  PAYMENT_PROVIDER: Joi.string()
    .valid('mock-bank', 'vnpay', 'momo', 'sepay', 'techcombank')
    .default('mock-bank'),
  MOCK_BANK_BASE_URL: Joi.string().uri().default('http://localhost:3001'),
  MOCK_BANK_SECRET: Joi.string()
    .min(32)
    .when('RENTAL_FLOW_V4_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
  FABRIC_ENABLED: Joi.boolean().default(false),
  FABRIC_MSP_ID: Joi.string().when('FABRIC_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  FABRIC_CHANNEL_NAME: Joi.string().when('FABRIC_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  FABRIC_CHAINCODE_NAME: Joi.string().when('FABRIC_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  FABRIC_PEER_ENDPOINT: Joi.string().when('FABRIC_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  FABRIC_PEER_HOST_ALIAS: Joi.string().when('FABRIC_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  FABRIC_CERT_PATH: Joi.string().when('FABRIC_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  FABRIC_KEY_PATH: Joi.string().when('FABRIC_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  FABRIC_TLS_CERT_PATH: Joi.string().when('FABRIC_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
})
