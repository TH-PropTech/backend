import {
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
} from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { SkipThrottle, Throttle, ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard'
import { Public } from '../decorators/public.decorator'
import { HttpThrottlerGuard } from './http-throttler.guard'

@Controller('probe')
class ProbeController {
  @Get('private')
  privateRoute(): { ok: boolean } {
    return { ok: true }
  }

  @Public()
  @Get('public')
  publicRoute(): { ok: boolean } {
    return { ok: true }
  }

  @Public()
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  @Get('strict')
  strictRoute(): { ok: boolean } {
    return { ok: true }
  }

  @Public()
  @SkipThrottle()
  @Get('free')
  freeRoute(): { ok: boolean } {
    return { ok: true }
  }
}

describe('global guards (APP_GUARD, as registered in AppModule)', () => {
  let app: INestApplication
  let token: string
  const server = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0]

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({ global: true, secret: 'test-secret' }),
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
      ],
      controllers: [ProbeController],
      providers: [
        { provide: APP_GUARD, useClass: HttpThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    token = moduleRef.get(JwtService).sign({ _id: 'u1', roles: ['tenant'] })
  })

  afterAll(async () => {
    await app.close()
  })

  it('rejects a route without @Public() when no token is sent', async () => {
    await request(server()).get('/probe/private').expect(401)
  })

  it('rejects an invalid token on a private route', async () => {
    await request(server())
      .get('/probe/private')
      .set('Authorization', 'Bearer not-a-token')
      .expect(401)
  })

  it('allows a private route with a valid token', async () => {
    await request(server())
      .get('/probe/private')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
  })

  it('allows a @Public() route without a token', async () => {
    await request(server()).get('/probe/public').expect(200)
  })

  it('applies the per-route @Throttle limit exactly once per request', async () => {
    await request(server()).get('/probe/strict').expect(200)
    await request(server()).get('/probe/strict').expect(200)
    await request(server()).get('/probe/strict').expect(429)
  })

  it('does not throttle @SkipThrottle() routes', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(server()).get('/probe/free').expect(200)
    }
  })
})

describe('global guards on non-http contexts (WebSocket)', () => {
  const wsContext = { getType: () => 'ws' } as unknown as ExecutionContext

  it('JwtAuthGuard lets WebSocket messages through (gateways authenticate themselves)', () => {
    const guard = new JwtAuthGuard({} as JwtService, {} as never)
    expect(guard.canActivate(wsContext)).toBe(true)
  })

  it('HttpThrottlerGuard skips WebSocket contexts', async () => {
    const guard = new HttpThrottlerGuard({} as never, {} as never, {} as never)
    await expect(guard.canActivate(wsContext)).resolves.toBe(true)
  })
})
