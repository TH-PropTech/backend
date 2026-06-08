import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { Response } from 'supertest'
import type { App as SupertestApp } from 'supertest/types'
import type { ApiResponse } from '../src/common/interfaces/api-response.interface'
import { AppModule } from '../src/app.module'
import { setupApp } from '../src/core/bootstrap/setup-app'
import type { HealthResponseDto } from '../src/features/health/dto/health-response.dto'

describe('App', () => {
  let app: INestApplication | undefined

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication()
    setupApp(app, app.get(ConfigService))
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('returns health response envelope', async () => {
    if (app === undefined) {
      throw new Error('Nest application was not initialized')
    }

    await request(app.getHttpServer() as SupertestApp)
      .get('/api/v1/health')
      .expect(200)
      .expect((response: Response) => {
        const body = response.body as ApiResponse<HealthResponseDto>

        expect(body.success).toBe(true)
        expect(body.data?.status).toBe('ok')
        expect(body.error).toBeNull()
        expect(body.meta.timestamp).toEqual(expect.any(String))
      })
  })
})
