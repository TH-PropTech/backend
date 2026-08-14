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
})

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}
