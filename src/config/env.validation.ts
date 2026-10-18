import Joi from 'joi'
import { parseEnabledProviders } from './configuration'

type FabricEnvironment = Record<string, unknown>

const FABRIC_ROLES = ['WRITER', 'READER', 'OPERATOR'] as const

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Production chỉ chấp nhận origin Explorer công khai qua https, không credential,
 * không query/fragment và không trỏ loopback/localhost. Không bao giờ echo URL trong lỗi.
 */
function isAllowedProductionExplorerUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return false
    if (url.username || url.password) return false
    if (url.search || url.hash) return false
    const host = url.hostname.toLowerCase()
    return !(
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '::1' ||
      host === '[::1]' ||
      /^127./.test(host) ||
      host === '0.0.0.0'
    )
  } catch {
    return false
  }
}

/**
 * PROP-399 D5: kiểm tra chéo cấu hình identity Fabric. Lỗi mang mã ổn định và không bao
 * giờ chứa đường dẫn/giá trị cấu hình.
 */
function validateFabricConfiguration(
  value: FabricEnvironment,
  helpers: Joi.CustomHelpers
): FabricEnvironment | ReturnType<Joi.CustomHelpers['message']> {
  const production = value.NODE_ENV === 'production'

  if (production && value.FABRIC_EXPLORER_PUBLIC_URL) {
    if (
      !isAllowedProductionExplorerUrl(text(value.FABRIC_EXPLORER_PUBLIC_URL))
    ) {
      return helpers.message({
        custom:
          'FABRIC_EXPLORER_URL_INVALID: FABRIC_EXPLORER_PUBLIC_URL must be an https origin without credentials, query, fragment or loopback host',
      })
    }
  }

  if (value.FABRIC_ENABLED !== true) return value

  const legacyConfigured =
    Boolean(text(value.FABRIC_CERT_PATH)) &&
    Boolean(text(value.FABRIC_KEY_PATH))
  const roleCerts = FABRIC_ROLES.map(role =>
    text(value[`FABRIC_${role}_CERT_PATH`])
  )
  const roleKeys = FABRIC_ROLES.map(role =>
    text(value[`FABRIC_${role}_KEY_PATH`])
  )
  const allRolesConfigured = [...roleCerts, ...roleKeys].every(Boolean)

  if (production) {
    const reasons: string[] = []
    if (!allRolesConfigured) {
      reasons.push(
        'writer, reader and operator certificate and key paths are all required (legacy FABRIC_CERT_PATH/FABRIC_KEY_PATH compatibility mode is not allowed)'
      )
    } else {
      if (new Set(roleCerts).size !== roleCerts.length) {
        reasons.push('role certificates must be distinct')
      }
      if (new Set(roleKeys).size !== roleKeys.length) {
        reasons.push('role private keys must be distinct')
      }
      const explorerCert = text(value.FABRIC_EXPLORER_CERT_PATH)
      if (explorerCert && roleCerts.includes(explorerCert)) {
        reasons.push(
          'the Explorer identity must not reuse a backend role certificate'
        )
      }
    }
    if (reasons.length > 0) {
      return helpers.message({
        custom: `FABRIC_IDENTITY_SEPARATION_REQUIRED: ${reasons.join('; ')}`,
      })
    }
    return value
  }

  const resolvable = FABRIC_ROLES.every((_, index) => {
    const hasCert = Boolean(roleCerts[index]) || legacyConfigured
    const hasKey = Boolean(roleKeys[index]) || legacyConfigured
    return hasCert && hasKey
  })
  if (!resolvable) {
    return helpers.message({
      custom:
        'FABRIC_CERT_PATH and FABRIC_KEY_PATH are required when role-specific Fabric identities are not fully configured',
    })
  }
  return value
}

const PROVIDER_CSV_PATTERN =
  /^\s*(mock-bank|vnpay|momo|zalopay|mocbank)(\s*,\s*(mock-bank|vnpay|momo|zalopay|mocbank))*\s*$/
const HTTP_URL = Joi.string()
  .uri({ scheme: ['http', 'https'] })
  .allow('')
  .optional()
const HTTPS_URL = Joi.string()
  .uri({ scheme: ['https'] })
  .allow('')
  .optional()

/** Keys each gateway needs once it is enabled; values are never echoed. */
const GATEWAY_REQUIRED_KEYS = {
  vnpay: ['VNPAY_TMN_CODE', 'VNPAY_HASH_SECRET'],
  momo: ['MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY'],
  zalopay: ['ZALOPAY_APP_ID', 'ZALOPAY_KEY1', 'ZALOPAY_KEY2'],
  mocbank: ['MOCBANK_MERCHANT_ID', 'MOCBANK_MERCHANT_SECRET'],
} as const
const GATEWAY_NOTIFY_URL_KEYS = {
  momo: 'MOMO_IPN_URL',
  zalopay: 'ZALOPAY_CALLBACK_URL',
  mocbank: 'MOCBANK_WEBHOOK_URL',
} as const

function validateEnabledGateways(
  env: Record<string, unknown>,
  helpers: Joi.CustomHelpers
): Record<string, unknown> | Joi.ErrorReport {
  const enabled = parseEnabledProviders(
    env.PAYMENT_PROVIDERS_ENABLED as string | undefined,
    env.PAYMENT_PROVIDER as string | undefined
  )
  for (const provider of enabled) {
    if (provider === 'mock-bank') continue
    const missing = GATEWAY_REQUIRED_KEYS[provider].filter(
      key => typeof env[key] !== 'string' || env[key] === ''
    )
    if (missing.length > 0) {
      return helpers.message({
        custom: `${provider} is enabled but ${missing.join(', ')} is not set`,
      })
    }
    if (provider !== 'vnpay' && env.NODE_ENV === 'production') {
      const notifyKey = GATEWAY_NOTIFY_URL_KEYS[provider]
      const notifyUrl = env[notifyKey]
      if (typeof notifyUrl !== 'string' || !notifyUrl.startsWith('https://')) {
        return helpers.message({
          custom: `${notifyKey} must be an https URL in production`,
        })
      }
    }
  }
  return env
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('local', 'development', 'test', 'staging', 'production')
    .default('local'),
  APP_PORT: Joi.number().port().default(3001),
  APP_URL: Joi.string().uri().default('http://localhost:3001'),
  APP_CORS_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_MS: Joi.number().integer().min(1000).default(60000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(100),
  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_LOGGING: Joi.boolean().default(false),
  DATABASE_SYNCHRONIZE: Joi.boolean().default(false),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  GROQ_API_KEY: Joi.string().allow('').optional(),
  GROQ_API_KEYS: Joi.string().allow('').optional(),
  // Length (>= 32) is checked by GroqKeysService, which is disabled while empty.
  GROQ_KEY_ENCRYPTION_SECRET: Joi.string().allow('').optional(),
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
    .valid(
      'mock-bank',
      'vnpay',
      'momo',
      'zalopay',
      'mocbank',
      'sepay',
      'techcombank'
    )
    .default('mock-bank'),
  PAYMENT_PROVIDERS_ENABLED: Joi.string()
    .pattern(PROVIDER_CSV_PATTERN)
    .allow('')
    .optional(),
  PAYMENT_GATEWAY_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(60000)
    .default(10000),
  PAYMENT_ATTEMPT_TTL_MINUTES: Joi.number()
    .integer()
    .min(5)
    .max(60)
    .default(15),
  PAYMENT_CLIENT_RETURN_URL: HTTP_URL,
  PAYMENT_MOBILE_RETURN_URL: Joi.string()
    .uri({ scheme: ['thproptech', 'exp', 'http', 'https'] })
    .allow('')
    .optional(),
  MOCK_BANK_BASE_URL: Joi.string().uri().default('http://localhost:3001'),
  MOCK_BANK_SECRET: Joi.string()
    .min(32)
    .when('RENTAL_FLOW_V4_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
  VNPAY_TMN_CODE: Joi.string().allow('').optional(),
  VNPAY_HASH_SECRET: Joi.string().allow('').optional(),
  VNPAY_PAY_URL: HTTPS_URL,
  VNPAY_RETURN_URL: HTTP_URL,
  VNPAY_CLIENT_RETURN_URL: HTTP_URL,
  MOMO_PARTNER_CODE: Joi.string().allow('').optional(),
  MOMO_ACCESS_KEY: Joi.string().allow('').optional(),
  MOMO_SECRET_KEY: Joi.string().allow('').optional(),
  MOMO_ENDPOINT: HTTPS_URL,
  MOMO_RETURN_URL: HTTP_URL,
  MOMO_IPN_URL: HTTP_URL,
  ZALOPAY_APP_ID: Joi.string().allow('').optional(),
  ZALOPAY_KEY1: Joi.string().allow('').optional(),
  ZALOPAY_KEY2: Joi.string().allow('').optional(),
  ZALOPAY_ENDPOINT: HTTPS_URL,
  ZALOPAY_RETURN_URL: HTTP_URL,
  ZALOPAY_CALLBACK_URL: HTTP_URL,
  MOCBANK_MERCHANT_ID: Joi.string().allow('').optional(),
  MOCBANK_MERCHANT_SECRET: Joi.string().allow('').optional(),
  MOCBANK_BASE_URL: HTTPS_URL,
  MOCBANK_RETURN_URL: HTTP_URL,
  MOCBANK_WEBHOOK_URL: HTTP_URL,
  DEPOSIT_ESCROW_ENABLED: Joi.boolean().default(false),
  FABRIC_ENABLED: Joi.boolean().default(false),
  FABRIC_EXPLORER_TX_URL_TEMPLATE: Joi.string()
    .pattern(/^\S*\{txId\}\S*$/)
    .allow('')
    .optional(),
  FABRIC_OUTBOX_POLL_INTERVAL_MS: Joi.number()
    .integer()
    .min(100)
    .max(600000)
    .default(5000),
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
  // Legacy một identity (chế độ tương thích, chỉ ngoài production) — được kiểm tra chéo ở validateFabricConfiguration.
  FABRIC_CERT_PATH: Joi.string().optional().allow(''),
  FABRIC_KEY_PATH: Joi.string().optional().allow(''),
  // PROP-399 D5: identity tách vai trò, cấu hình theo đường dẫn file/secret mount.
  FABRIC_WRITER_CERT_PATH: Joi.string().optional().allow(''),
  FABRIC_WRITER_KEY_PATH: Joi.string().optional().allow(''),
  FABRIC_READER_CERT_PATH: Joi.string().optional().allow(''),
  FABRIC_READER_KEY_PATH: Joi.string().optional().allow(''),
  FABRIC_OPERATOR_CERT_PATH: Joi.string().optional().allow(''),
  FABRIC_OPERATOR_KEY_PATH: Joi.string().optional().allow(''),
  // Chỉ chứng chỉ công khai của Explorer, dùng để chứng minh nó không dùng chung identity với backend.
  FABRIC_EXPLORER_CERT_PATH: Joi.string().optional().allow(''),
  FABRIC_IDENTITY_EXPIRY_WARN_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(365)
    .default(30),
  FABRIC_EXPLORER_ENABLED: Joi.boolean().default(false),
  FABRIC_EXPLORER_PUBLIC_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .when('FABRIC_EXPLORER_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
  FABRIC_EXPLORER_HEALTH_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional()
    .allow(''),
  EVIDENCE_PACKAGE_MAX_FILES: Joi.number()
    .integer()
    .min(1)
    .max(500)
    .default(50),
  EVIDENCE_PACKAGE_MAX_BYTES: Joi.number()
    .integer()
    .min(1048576)
    .max(1073741824)
    .default(104857600),
  FABRIC_RECONCILIATION_PAGE_SIZE: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(100),
  FABRIC_RECONCILIATION_ORPHAN_PAGE_BUDGET: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(10),
  FABRIC_RECONCILIATION_MAX_CONTRACTS: Joi.number()
    .integer()
    .min(1)
    .max(10000)
    .default(500),
  FABRIC_TLS_CERT_PATH: Joi.string().when('FABRIC_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  RENTAL_SCHEDULER_ENABLED: Joi.boolean().default(false),
  DEPOSIT_AGREEMENT_TTL_HOURS: Joi.number()
    .integer()
    .min(1)
    .max(720)
    .default(72),
  RENTAL_STUCK_PROVISIONING_FAILED_MINUTES: Joi.number()
    .integer()
    .min(1)
    .max(10080)
    .default(30),
  RENTAL_STUCK_DEPOSIT_ATTEMPT_EXPIRED_MINUTES: Joi.number()
    .integer()
    .min(1)
    .max(10080)
    .default(15),
  RENTAL_STUCK_DEPOSIT_UNPAID_HOURS: Joi.number()
    .integer()
    .min(1)
    .max(8760)
    .default(24),
  RENTAL_STUCK_SIGNED_PENDING_DEPOSIT_HOURS: Joi.number()
    .integer()
    .min(1)
    .max(8760)
    .default(24),
  RENTAL_STUCK_ACTIVATION_FAILURE_MINUTES: Joi.number()
    .integer()
    .min(1)
    .max(10080)
    .default(15),
  RENTAL_STUCK_LEDGER_FAILED_TERMINAL_MINUTES: Joi.number()
    .integer()
    .min(1)
    .max(10080)
    .default(15),
  RENTAL_STUCK_SETTLEMENT_OVERDUE_HOURS: Joi.number()
    .integer()
    .min(1)
    .max(8760)
    .default(24),
  RENTAL_STUCK_HANDOVER_OVERDUE_HOURS: Joi.number()
    .integer()
    .min(1)
    .max(8760)
    .default(24),
})
  .custom(validateFabricConfiguration)
  .custom(validateEnabledGateways)
