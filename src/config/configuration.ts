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
  }
  database: {
    url: string
    logging: boolean
    synchronize: boolean
  }
} => ({
  app: {
    env: (process.env.NODE_ENV ?? 'local') as AppEnvironment,
    port: Number(process.env.APP_PORT ?? 3001),
    url: process.env.APP_URL ?? 'http://localhost:3001',
    corsOrigins: parseCsv(
      process.env.APP_CORS_ORIGINS ?? 'http://localhost:3000'
    ),
  },
  database: {
    url: process.env.DATABASE_URL ?? 'mongodb://localhost:27017/th_proptech',
    logging: process.env.DATABASE_LOGGING === 'true',
    synchronize:
      process.env.NODE_ENV !== 'production' &&
      process.env.DATABASE_SYNCHRONIZE === 'true',
  },
})

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}
