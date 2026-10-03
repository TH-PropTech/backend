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
  database: {
    url: string
    logging: boolean
    synchronize: boolean
  }
  redis: {
    url: string
  }
  groq: {
    apiKey: string
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
    paymentProvider: 'mock-bank' | 'vnpay' | 'momo' | 'sepay' | 'techcombank'
    mockBankBaseUrl: string
    mockBankSecret: string
    vnpayGatewayUrl: string
    vnpayReturnUrl: string
    vnpayHashSecret: string
    vnpayClientReturnUrl: string
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
    apiKey: process.env.GROQ_API_KEY ?? '',
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
    paymentProvider: (process.env.PAYMENT_PROVIDER ?? 'mock-bank') as
      | 'mock-bank'
      | 'vnpay'
      | 'momo'
      | 'sepay'
      | 'techcombank',
    mockBankBaseUrl: process.env.MOCK_BANK_BASE_URL ?? 'http://localhost:3001',
    mockBankSecret: process.env.MOCK_BANK_SECRET ?? '',
    vnpayGatewayUrl:
      process.env.VNPAY_GATEWAY_URL ??
      'http://localhost:8888/order/create_payment_for_transaction',
    vnpayReturnUrl:
      process.env.VNPAY_RETURN_URL ??
      'http://localhost:3001/api/v1/bank/vnpay/return',
    vnpayHashSecret: process.env.VNPAY_HASH_SECRET ?? '',
    vnpayClientReturnUrl:
      process.env.VNPAY_CLIENT_RETURN_URL ?? 'http://localhost:3000',
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
