import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { AppModule } from './app.module'
import { setupApp } from './core/bootstrap/setup-app'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  const configService = app.get(ConfigService)

  setupApp(app, configService)

  await app.listen(configService.getOrThrow<number>('app.port'))
}

void bootstrap()
