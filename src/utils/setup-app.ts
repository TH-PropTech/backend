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
import compression from 'compression'
import * as express from 'express'
import helmet from 'helmet'
import * as path from 'path'

export function setupApp(
  app: INestApplication,
  configService: ConfigService
): void {
  // Sau Nginx, req.ip phải lấy từ X-Forwarded-For với đúng số lớp proxy tin cậy
  const expressApp = app.getHttpAdapter().getInstance() as express.Express
  expressApp.set(
    'trust proxy',
    configService.getOrThrow<number>('security.trustProxyHops')
  )
  app.use(compression())
  // API trả JSON nên bỏ CSP (upgrade-insecure-requests làm hỏng Swagger khi chạy HTTP);
  // cross-origin để frontend khác origin hiển thị được ảnh trong /uploads
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  )
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))
  app.setGlobalPrefix('api')
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  })
  app.enableCors({
    origin: configService.getOrThrow<string[]>('app.corsOrigins'),
    credentials: true,
    exposedHeaders: ['X-Total-Count', 'Retry-After'],
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
