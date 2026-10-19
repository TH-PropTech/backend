export const SELECTABLE_PAYMENT_PROVIDERS = [
  'mock-bank',
  'vnpay',
  'momo',
  'zalopay',
  'mocbank',
] as const
export type SelectablePaymentProvider =
  (typeof SELECTABLE_PAYMENT_PROVIDERS)[number]

export type PaymentsConfig = {
  enabledProviders: SelectablePaymentProvider[]
  gatewayTimeoutMs: number
  attemptTtlMinutes: number
  clientReturnUrl: string
  mobileReturnUrl: string
  vnpay: {
    tmnCode: string
    hashSecret: string
    payUrl: string
    returnUrl: string
  }
  momo: {
    partnerCode: string
    accessKey: string
    secretKey: string
    endpoint: string
    returnUrl: string
    ipnUrl: string
  }
  zalopay: {
    appId: string
    key1: string
    key2: string
    endpoint: string
    returnUrl: string
    callbackUrl: string
  }
  mocbank: {
    baseUrl: string
    merchantId: string
    merchantSecret: string
    returnUrl: string
    webhookUrl: string
  }
}

/** Env value with surrounding whitespace removed; blank counts as unset. */
function envOr(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value ? value : fallback
}

/** CSV allow-list; falls back to the legacy single PAYMENT_PROVIDER, then mock-bank. */
export function parseEnabledProviders(
  csv: string | undefined,
  legacy: string | undefined
): SelectablePaymentProvider[] {
  const raw = csv?.trim() ? csv : (legacy ?? 'mock-bank')
  const names = raw
    .split(',')
    .map(name => name.trim())
    .filter((name): name is SelectablePaymentProvider =>
      (SELECTABLE_PAYMENT_PROVIDERS as readonly string[]).includes(name)
    )
  return names.length > 0 ? [...new Set(names)] : ['mock-bank']
}

export type AppEnvironment =
  | 'local'
  | 'development'
  | 'test'
  | 'staging'
  | 'production'

export const configuration = (): {
  app: {
    env: AppEnvironment
    port: number
    url: string
    corsOrigins: string[]
    recommendationApiUrl: string
  }
  security: {
    rateLimitTtl: number
    rateLimitMax: number
  }
  database: {
    url: string
    logging: boolean
    synchronize: boolean
  }
  redis: {
    url: string
  }
  groq: {
    apiKeys: string[]
    keyEncryptionSecret: string
  }
  ekyc: {
    serviceUrl: string
    faceServiceUrl: string
    requestTimeoutMs: number
  }
  kyc: {
    mediaEncryptionKey: string
    privateMediaDir: string
  }
  cloudinary: {
    cloudName: string
    apiKey: string
    apiSecret: string
  }
  rentalFlow: {
    enabled: boolean
    mockBankBaseUrl: string
    mockBankSecret: string
    payments: PaymentsConfig
  }
  fabric: {
    enabled: boolean
    explorerTxUrlTemplate: string | undefined
    outboxPollIntervalMs: number
    mspId: string
    channelName: string
    chaincodeName: string
    peerEndpoint: string
    peerHostAlias: string
    /** Legacy một identity — chỉ còn ở chế độ tương thích ngoài production. */
    certPath: string
    keyPath: string
    tlsCertPath: string
    /** PROP-399 D5: identity tách vai trò, theo đường dẫn file/secret mount. */
    identities: Record<
      'writer' | 'reader' | 'operator',
      { certPath: string; keyPath: string }
    >
    identityExpiryWarnDays: number
    explorer: {
      enabled: boolean
      publicUrl: string | undefined
      healthUrl: string | undefined
      /** Chỉ chứng chỉ công khai để chứng minh Explorer không dùng chung identity với backend. */
      certPath: string
    }
    reconciliation: {
      pageSize: number
      orphanPageBudget: number
      maxContracts: number
    }
  }
  evidencePackage: {
    maxFiles: number
    maxBytes: number
  }
  rentalOps: {
    schedulerEnabled: boolean
    depositAgreementTtlHours: number
    stuckThresholds: {
      provisioningFailedMinutes: number
      depositAttemptExpiredMinutes: number
      depositUnpaidHours: number
      signedPendingDepositHours: number
      activationFailureMinutes: number
      ledgerFailedTerminalMinutes: number
      settlementOverdueHours: number
      handoverOverdueHours: number
    }
  }
} => ({
  app: {
    env: (process.env.NODE_ENV ?? 'local') as AppEnvironment,
    port: Number(process.env.APP_PORT ?? 3001),
    url: process.env.APP_URL ?? 'http://localhost:3001',
    corsOrigins: parseCsv(
      process.env.APP_CORS_ORIGINS ?? 'http://localhost:3000'
    ),
    recommendationApiUrl:
      process.env.RECOMMENDATION_API_URL ?? 'http://localhost:5001/api',
  },
  security: {
    rateLimitTtl: Number(process.env.RATE_LIMIT_TTL_MS ?? 60000),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 100),
  },
  database: {
    url: process.env.DATABASE_URL ?? 'mongodb://localhost:27017/th_proptech',
    logging: process.env.DATABASE_LOGGING === 'true',
    synchronize:
      process.env.NODE_ENV !== 'production' &&
      process.env.DATABASE_SYNCHRONIZE === 'true',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  groq: {
    apiKeys: [
      ...new Set(
        `${process.env.GROQ_API_KEYS ?? ''},${process.env.GROQ_API_KEY ?? ''}`
          .split(',')
          .map(key => key.trim())
          .filter(Boolean)
      ),
    ],
    keyEncryptionSecret: process.env.GROQ_KEY_ENCRYPTION_SECRET ?? '',
  },
  ekyc: {
    serviceUrl: process.env.EKYC_SERVICE_URL ?? '',
    faceServiceUrl:
      process.env.THEKYC_SERVICE_URL ?? process.env.EKYC_SERVICE_URL ?? '',
    requestTimeoutMs: Number(process.env.EKYC_REQUEST_TIMEOUT_MS ?? 60000),
  },
  kyc: {
    mediaEncryptionKey: process.env.KYC_MEDIA_ENCRYPTION_KEY ?? '',
    privateMediaDir: process.env.KYC_PRIVATE_MEDIA_DIR ?? '.data/kyc',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
  rentalFlow: {
    enabled: process.env.RENTAL_FLOW_V4_ENABLED === 'true',
    mockBankBaseUrl: process.env.MOCK_BANK_BASE_URL ?? 'http://localhost:3001',
    mockBankSecret: process.env.MOCK_BANK_SECRET ?? '',
    payments: {
      enabledProviders: parseEnabledProviders(
        process.env.PAYMENT_PROVIDERS_ENABLED,
        process.env.PAYMENT_PROVIDER
      ),
      gatewayTimeoutMs: Number(envOr('PAYMENT_GATEWAY_TIMEOUT_MS', '10000')),
      attemptTtlMinutes: Number(envOr('PAYMENT_ATTEMPT_TTL_MINUTES', '15')),
      clientReturnUrl:
        envOr('PAYMENT_CLIENT_RETURN_URL', '') ||
        envOr('VNPAY_CLIENT_RETURN_URL', 'http://localhost:3000'),
      mobileReturnUrl: envOr(
        'PAYMENT_MOBILE_RETURN_URL',
        'thproptech://payment-result'
      ),
      vnpay: {
        tmnCode: envOr('VNPAY_TMN_CODE', ''),
        hashSecret: envOr('VNPAY_HASH_SECRET', ''),
        payUrl: envOr(
          'VNPAY_PAY_URL',
          'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'
        ),
        returnUrl: envOr(
          'VNPAY_RETURN_URL',
          'http://localhost:3001/api/v1/bank/vnpay/return'
        ),
      },
      momo: {
        partnerCode: envOr('MOMO_PARTNER_CODE', ''),
        accessKey: envOr('MOMO_ACCESS_KEY', ''),
        secretKey: envOr('MOMO_SECRET_KEY', ''),
        endpoint: envOr(
          'MOMO_ENDPOINT',
          'https://test-payment.momo.vn/v2/gateway/api/create'
        ),
        returnUrl: envOr(
          'MOMO_RETURN_URL',
          'http://localhost:3001/api/v1/bank/momo/return'
        ),
        ipnUrl: envOr(
          'MOMO_IPN_URL',
          'http://localhost:3001/api/v1/bank/momo/ipn'
        ),
      },
      zalopay: {
        appId: envOr('ZALOPAY_APP_ID', ''),
        key1: envOr('ZALOPAY_KEY1', ''),
        key2: envOr('ZALOPAY_KEY2', ''),
        endpoint: envOr(
          'ZALOPAY_ENDPOINT',
          'https://sb-openapi.zalopay.vn/v2/create'
        ),
        returnUrl: envOr(
          'ZALOPAY_RETURN_URL',
          'http://localhost:3001/api/v1/bank/zalopay/return'
        ),
        callbackUrl: envOr(
          'ZALOPAY_CALLBACK_URL',
          'http://localhost:3001/api/v1/bank/zalopay/callback'
        ),
      },
      mocbank: {
        // Trailing slash stripped: adapters append `/api/...` paths.
        baseUrl: envOr(
          'MOCBANK_BASE_URL',
          'https://bank-sanboxv1.vercel.app'
        ).replace(/\/+$/, ''),
        merchantId: envOr('MOCBANK_MERCHANT_ID', ''),
        merchantSecret: envOr('MOCBANK_MERCHANT_SECRET', ''),
        returnUrl: envOr(
          'MOCBANK_RETURN_URL',
          'http://localhost:3001/api/v1/bank/mocbank/return'
        ),
        webhookUrl: envOr('MOCBANK_WEBHOOK_URL', ''),
      },
    },
  },
  fabric: {
    enabled: process.env.FABRIC_ENABLED === 'true',
    explorerTxUrlTemplate:
      process.env.FABRIC_EXPLORER_TX_URL_TEMPLATE || undefined,
    outboxPollIntervalMs: Number(
      process.env.FABRIC_OUTBOX_POLL_INTERVAL_MS ?? 5000
    ),
    mspId: process.env.FABRIC_MSP_ID ?? 'Org1MSP',
    channelName: process.env.FABRIC_CHANNEL_NAME ?? 'proptech-channel',
    chaincodeName: process.env.FABRIC_CHAINCODE_NAME ?? 'proptech',
    peerEndpoint: process.env.FABRIC_PEER_ENDPOINT ?? 'localhost:7051',
    peerHostAlias:
      process.env.FABRIC_PEER_HOST_ALIAS ?? 'peer0.org1.example.com',
    certPath: process.env.FABRIC_CERT_PATH ?? '',
    keyPath: process.env.FABRIC_KEY_PATH ?? '',
    tlsCertPath: process.env.FABRIC_TLS_CERT_PATH ?? '',
    identities: {
      writer: {
        certPath: process.env.FABRIC_WRITER_CERT_PATH ?? '',
        keyPath: process.env.FABRIC_WRITER_KEY_PATH ?? '',
      },
      reader: {
        certPath: process.env.FABRIC_READER_CERT_PATH ?? '',
        keyPath: process.env.FABRIC_READER_KEY_PATH ?? '',
      },
      operator: {
        certPath: process.env.FABRIC_OPERATOR_CERT_PATH ?? '',
        keyPath: process.env.FABRIC_OPERATOR_KEY_PATH ?? '',
      },
    },
    identityExpiryWarnDays: Number(
      process.env.FABRIC_IDENTITY_EXPIRY_WARN_DAYS ?? 30
    ),
    explorer: {
      enabled: process.env.FABRIC_EXPLORER_ENABLED === 'true',
      publicUrl: process.env.FABRIC_EXPLORER_PUBLIC_URL || undefined,
      healthUrl: process.env.FABRIC_EXPLORER_HEALTH_URL || undefined,
      certPath: process.env.FABRIC_EXPLORER_CERT_PATH ?? '',
    },
    reconciliation: {
      pageSize: Number(process.env.FABRIC_RECONCILIATION_PAGE_SIZE ?? 100),
      orphanPageBudget: Number(
        process.env.FABRIC_RECONCILIATION_ORPHAN_PAGE_BUDGET ?? 10
      ),
      maxContracts: Number(
        process.env.FABRIC_RECONCILIATION_MAX_CONTRACTS ?? 500
      ),
    },
  },
  evidencePackage: {
    maxFiles: Number(process.env.EVIDENCE_PACKAGE_MAX_FILES ?? 50),
    maxBytes: Number(process.env.EVIDENCE_PACKAGE_MAX_BYTES ?? 104857600),
  },
  rentalOps: {
    schedulerEnabled: process.env.RENTAL_SCHEDULER_ENABLED === 'true',
    depositAgreementTtlHours: Number(
      process.env.DEPOSIT_AGREEMENT_TTL_HOURS ?? 72
    ),
    stuckThresholds: {
      provisioningFailedMinutes: Number(
        process.env.RENTAL_STUCK_PROVISIONING_FAILED_MINUTES ?? 30
      ),
      depositAttemptExpiredMinutes: Number(
        process.env.RENTAL_STUCK_DEPOSIT_ATTEMPT_EXPIRED_MINUTES ?? 15
      ),
      depositUnpaidHours: Number(
        process.env.RENTAL_STUCK_DEPOSIT_UNPAID_HOURS ?? 24
      ),
      signedPendingDepositHours: Number(
        process.env.RENTAL_STUCK_SIGNED_PENDING_DEPOSIT_HOURS ?? 24
      ),
      activationFailureMinutes: Number(
        process.env.RENTAL_STUCK_ACTIVATION_FAILURE_MINUTES ?? 15
      ),
      ledgerFailedTerminalMinutes: Number(
        process.env.RENTAL_STUCK_LEDGER_FAILED_TERMINAL_MINUTES ?? 15
      ),
      settlementOverdueHours: Number(
        process.env.RENTAL_STUCK_SETTLEMENT_OVERDUE_HOURS ?? 24
      ),
      handoverOverdueHours: Number(
        process.env.RENTAL_STUCK_HANDOVER_OVERDUE_HOURS ?? 24
      ),
    },
  },
})

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}
