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
    corsOrigins: string[]
  }
  database: {
    host: string
    port: number
    username: string
    password: string
    name: string
    ssl: boolean
    logging: boolean
    synchronize: boolean
  }
} => ({
  app: {
    env: (process.env.NODE_ENV ?? 'local') as AppEnvironment,
    port: Number(process.env.APP_PORT ?? 3001),
    corsOrigins: parseCsv(
      process.env.APP_CORS_ORIGINS ?? 'http://localhost:3000'
    ),
  },
  database: {
    host: process.env.DATABASE_HOST ?? '',
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER ?? '',
    password: process.env.DATABASE_PASSWORD ?? '',
    name: process.env.DATABASE_NAME ?? '',
    ssl: process.env.DATABASE_SSL === 'true',
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
