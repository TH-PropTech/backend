import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { NextFunction, Request as ExpressRequest, Response } from 'express'
import request from 'supertest'
import type { Response as SupertestResponse } from 'supertest'
import type { App as SupertestApp } from 'supertest/types'

import type { ApiResponse } from '../src/common/interfaces/api-response.interface'
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard'
import { BiometricGrantService } from '../src/modules/ekyc/services/biometric-grant.service'
import { EkycProxyService } from '../src/modules/ekyc/services/ekyc-proxy.service'
import { KycController } from '../src/modules/users/controllers/kyc.controller'
import { KycService } from '../src/modules/users/services/kyc.service'

type AuthenticatedRequest = ExpressRequest & {
  user?: { _id: string; roles: string[] }
}

describe('KYC HTTP flow', () => {
  let app: INestApplication
  let status: 'pending' | 'verified' | null = null
  const grants = new BiometricGrantService()
  const proxy = {
    ocrFront: jest.fn().mockResolvedValue({
      idNumber: '079123456789',
      fullName: 'Nguyen Van A',
      dob: '01/01/2000',
      gender: 'Nam',
      nationality: 'Viet Nam',
    }),
    ocrBack: jest.fn().mockResolvedValue({ success: true }),
    verifyFace: jest.fn().mockResolvedValue({
      verified: true,
      faceMatch: true,
      liveness: true,
      realConfidence: 0.91,
    }),
  }
  const service = {
    submitKyc: jest.fn().mockImplementation((userId: string) => {
      grants.consume(userId)
      status = 'pending'
      return Promise.resolve({ status })
    }),
    findMine: jest.fn().mockImplementation(() =>
      Promise.resolve(
        status
          ? {
              id: '507f1f77bcf86cd799439012',
              status,
              idCardNumber: '079123456789',
            }
          : null
      )
    ),
    review: jest.fn().mockImplementation(() => {
      status = 'verified'
      return Promise.resolve({ status })
    }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KycController],
      providers: [
        { provide: KycService, useValue: service },
        { provide: EkycProxyService, useValue: proxy },
        { provide: BiometricGrantService, useValue: grants },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile()

    app = moduleRef.createNestApplication()
    app.use((req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      req.user = {
        _id: '507f1f77bcf86cd799439011',
        roles: req.headers['x-test-role'] === 'staff' ? ['staff'] : ['tenant'],
      }
      next()
    })
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor())
    await app.init()
  })

  afterAll(async () => app.close())

  it('runs biometric grant, multipart submit, owner status, and staff review', async () => {
    const server = app.getHttpServer() as SupertestApp
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb])

    await request(server)
      .post('/kyc/ocr-front')
      .attach('frontID', jpeg, {
        filename: 'front.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201)
      .expect((response: SupertestResponse) => {
        const body = response.body as ApiResponse<Record<string, unknown>>
        expect(body.data?.idNumber).toBe('079123456789')
      })

    await request(server)
      .post('/kyc/verify-face')
      .attach('portraitImages', jpeg, {
        filename: 'selfie.jpg',
        contentType: 'image/jpeg',
      })
      .attach('frontID', jpeg, {
        filename: 'front.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201)
      .expect((response: SupertestResponse) => {
        const body = response.body as ApiResponse<Record<string, unknown>>
        expect(body.data?.verified).toBe(true)
      })

    await request(server)
      .post('/kyc/submit')
      .field('idCardNumber', '079123456789')
      .attach('frontCard', jpeg, {
        filename: 'front.jpg',
        contentType: 'image/jpeg',
      })
      .attach('backCard', jpeg, {
        filename: 'back.jpg',
        contentType: 'image/jpeg',
      })
      .attach('selfie', jpeg, {
        filename: 'selfie.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201)
      .expect((response: SupertestResponse) => {
        const body = response.body as ApiResponse<Record<string, unknown>>
        expect(body.data?.status).toBe('pending')
      })

    await request(server)
      .get('/kyc/me')
      .expect(200)
      .expect((response: SupertestResponse) => {
        const body = response.body as ApiResponse<Record<string, unknown>>
        expect(body.data?.status).toBe('pending')
      })

    await request(server)
      .patch('/kyc/507f1f77bcf86cd799439012/review')
      .set('x-test-role', 'staff')
      .send({ status: 'verified' })
      .expect(200)
      .expect((response: SupertestResponse) => {
        const body = response.body as ApiResponse<Record<string, unknown>>
        expect(body.data?.status).toBe('verified')
      })
  })
})
