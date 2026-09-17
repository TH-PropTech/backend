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
  rentalFlow: {
    enabled: boolean
    paymentProvider: 'mock-bank' | 'vnpay' | 'momo' | 'sepay' | 'techcombank'
    mockBankBaseUrl: string
    mockBankSecret: string
  }
  fabric: {
    enabled: boolean
    mspId: string
    channelName: string
    chaincodeName: string
    peerEndpoint: string
    peerHostAlias: string
    certPath: string
    keyPath: string
    tlsCertPath: string
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
  },
  fabric: {
    enabled: process.env.FABRIC_ENABLED === 'true',
    mspId: process.env.FABRIC_MSP_ID ?? 'Org1MSP',
    channelName: process.env.FABRIC_CHANNEL_NAME ?? 'proptech-channel',
    chaincodeName: process.env.FABRIC_CHAINCODE_NAME ?? 'proptech',
    peerEndpoint: process.env.FABRIC_PEER_ENDPOINT ?? 'localhost:7051',
    peerHostAlias:
      process.env.FABRIC_PEER_HOST_ALIAS ?? 'peer0.org1.example.com',
    certPath: process.env.FABRIC_CERT_PATH ?? '',
    keyPath: process.env.FABRIC_KEY_PATH ?? '',
    tlsCertPath: process.env.FABRIC_TLS_CERT_PATH ?? '',
  },
})

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}
