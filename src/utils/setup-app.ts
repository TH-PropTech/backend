import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WsAdapter } from '@nestjs/platform-ws'
import { setupSwagger } from '@/config/swagger.config'
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter'
import { ResponseEnvelopeInterceptor } from '@/common/interceptors/response-envelope.interceptor'
import * as express from 'express'
import * as path from 'path'

export function setupApp(
  app: INestApplication,
  configService: ConfigService
): void {
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))
  app.setGlobalPrefix('api')
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  })
  app.enableCors({
    origin: configService.getOrThrow<string[]>('app.corsOrigins'),
    credentials: true,
  })
  app.useWebSocketAdapter(new WsAdapter(app))
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  )
  app.useGlobalFilters(new HttpExceptionFilter())
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor())

  setupSwagger(app)
}
