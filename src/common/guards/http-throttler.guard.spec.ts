import { Controller, Get, INestApplication } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { Throttle, ThrottlerModule } from '@nestjs/throttler'
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface'
import type { Express } from 'express'
import request from 'supertest'
import { HttpExceptionFilter } from '../filters/http-exception.filter'
import { HttpThrottlerGuard } from './http-throttler.guard'

@Controller('probe')
class ProbeController {
  @Get('open')
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  open(): { ok: boolean } {
    return { ok: true }
  }
}

class BrokenStorage {
  calls = 0

  increment(): Promise<ThrottlerStorageRecord> {
    this.calls += 1
    return Promise.reject(new Error('redis down'))
  }
}

async function createApp(storage?: BrokenStorage): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot(
        storage
          ? { throttlers: [{ ttl: 60000, limit: 2 }], storage }
          : [{ ttl: 60000, limit: 2 }]
      ),
    ],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
  }).compile()
  const app = moduleRef.createNestApplication()
  const expressApp = app.getHttpAdapter().getInstance() as Express
  expressApp.set('trust proxy', 1)
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.init()
  return app
}

describe('HttpThrottlerGuard', () => {
  describe('with a working storage', () => {
    let app: INestApplication
    const server = (): Parameters<typeof request>[0] =>
      app.getHttpServer() as Parameters<typeof request>[0]

    beforeAll(async () => {
      app = await createApp()
    })

    afterAll(async () => {
      await app.close()
    })

    it('counts each client IP from X-Forwarded-For separately', async () => {
      await request(server())
        .get('/probe/open')
        .set('X-Forwarded-For', '203.0.113.1')
        .expect(200)
      await request(server())
        .get('/probe/open')
        .set('X-Forwarded-For', '203.0.113.1')
        .expect(200)
      await request(server())
        .get('/probe/open')
        .set('X-Forwarded-For', '203.0.113.1')
        .expect(429)

      await request(server())
        .get('/probe/open')
        .set('X-Forwarded-For', '203.0.113.2')
        .expect(200)
    })

    it('answers 429 with Retry-After and a Vietnamese message', async () => {
      const ip = '203.0.113.9'
      for (let i = 0; i < 2; i += 1) {
        await request(server())
          .get('/probe/open')
          .set('X-Forwarded-For', ip)
          .expect(200)
      }

      const response = await request(server())
        .get('/probe/open')
        .set('X-Forwarded-For', ip)
        .expect(429)

      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'HTTP_429',
          message: expect.stringMatching(
            /^Bạn thao tác quá nhanh\. Vui lòng thử lại sau \d+ (giây|phút)\.$/
          ) as string,
          details: {
            code: 'RATE_LIMITED',
            scope: 'global',
            retryAfterSeconds: Number(response.headers['retry-after']),
          },
        },
      })
    })
  })

  describe('when the storage fails', () => {
    let app: INestApplication
    const storage = new BrokenStorage()

    beforeAll(async () => {
      app = await createApp(storage)
    })

    afterAll(async () => {
      await app.close()
    })

    it('lets the request through instead of returning 5xx', async () => {
      for (let i = 0; i < 5; i += 1) {
        await request(app.getHttpServer() as Parameters<typeof request>[0])
          .get('/probe/open')
          .expect(200)
      }
    })

    it('stops calling the storage during the cooldown', () => {
      expect(storage.calls).toBe(1)
    })
  })
})
