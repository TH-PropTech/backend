import 'dotenv/config'
import { DataSource } from 'typeorm'

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres',
  database: process.env.DATABASE_NAME ?? 'th_proptech',
  ssl: process.env.DATABASE_SSL === 'true',
  logging: process.env.DATABASE_LOGGING === 'true',
  synchronize: false,
  entities: ['src/features/**/*.entity.ts'],
  migrations: ['src/core/database/migrations/*.ts'],
})

export default dataSource
