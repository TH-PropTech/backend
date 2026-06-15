import * as dotenv from 'dotenv'
import * as dns from 'dns'
import * as path from 'path'

// Nạp tệp .env sớm để lấy cấu hình DNS
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const dnsServers = process.env.NODE_DNS_SERVERS
if (dnsServers) {
  const servers = dnsServers
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (servers.length > 0) {
    try {
      dns.setServers(servers)
    } catch (err) {
      console.warn('Không thể thiết lập DNS servers tùy chỉnh:', err)
    }
  }
}

import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { AppModule } from './app.module'
import { setupApp } from './utils/setup-app'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
    bufferLogs: true,
  })
  const configService = app.get(ConfigService)

  setupApp(app, configService)

  const port = configService.getOrThrow<number>('app.port')
  await app.listen(port)

  console.log(`\n Server is running on: http://localhost:${port}`)
  console.log(` Connected to MongoDB successfully!\n`)
}

void bootstrap()
