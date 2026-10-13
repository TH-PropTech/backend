import {
  ConflictException,
  UnauthorizedException,
  ValidationPipe,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App as SupertestApp } from 'supertest/types'

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor'
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard'
import { LegalSourcesController } from '../src/modules/legal/controllers/legal-sources.controller'
import { LegalSourcesService } from '../src/modules/legal/services/legal-sources.service'
import { PlatformRegulationsController } from '../src/modules/admin/controllers/platform-regulations.controller'
import { PlatformRegulationsService } from '../src/modules/admin/services/platform-regulations.service'

/** Thay JWT bằng header `x-test-role`; không có header → 401. RolesGuard giữ nguyên bản thật. */
const fakeJwtGuard = {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: unknown }>()
    const role = req.headers['x-test-role']
    if (!role) throw new UnauthorizedException()
    req.user = { _id: 'user-1', roles: [role] }
    return true
  },
}

const VALID_SOURCE = {
  key: 'residence-law-2020',
  kind: 'legal_text',
  code: 'Luật 68/2020/QH14',
  title: 'Luật Cư trú 2020',
  subtitle: '',
  agency: 'Quốc hội',
  duration: '',
  fee: '',
  externalUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=200519',
  icon: 'law',
  description: '',
  dossierItems: [],
  steps: [],
  legalGrounds: [],
  notes: [],
}

describe('Legal sources HTTP', () => {
  let app: INestApplication
  let server: SupertestApp
  const sources = {
    findPublic: jest.fn().mockResolvedValue([{ key: '1.004194' }]),
    findPublicByKey: jest.fn().mockResolvedValue({ key: '1.004194' }),
    findAllAdmin: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ key: 'residence-law-2020' }),
    update: jest.fn().mockResolvedValue({ key: '1.004194' }),
    remove: jest.fn().mockRejectedValue(
      new ConflictException({
        code: 'LEGAL_SOURCE_IN_USE',
        message: 'Nguồn đang được quy định tham chiếu: REG-RES-01',
        regulationCodes: ['REG-RES-01'],
      })
    ),
    reorder: jest.fn().mockResolvedValue([]),
  }
  const regulations = { findAllAdmin: jest.fn().mockResolvedValue([]) }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LegalSourcesController, PlatformRegulationsController],
      providers: [
        { provide: LegalSourcesService, useValue: sources },
        { provide: PlatformRegulationsService, useValue: regulations },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeJwtGuard)
      .compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      })
    )
    app.useGlobalFilters(new HttpExceptionFilter())
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor())
    await app.init()
    server = app.getHttpServer() as SupertestApp
  })

  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('serves contract panel sources publicly', async () => {
    await request(server).get('/legal-sources?panel=contract').expect(200)
    expect(sources.findPublic).toHaveBeenCalledWith('contract')
  })

  it('rejects unknown panel value', async () => {
    await request(server).get('/legal-sources?panel=home').expect(400)
  })

  it('routes /legal-sources/admin to the admin handler, not :key', async () => {
    await request(server).get('/legal-sources/admin').expect(401)
    expect(sources.findPublicByKey).not.toHaveBeenCalled()
  })

  it.each(['staff', 'landlord', 'tenant'])(
    'forbids %s from admin endpoints',
    async role => {
      await request(server)
        .get('/legal-sources/admin')
        .set('x-test-role', role)
        .expect(403)
      await request(server)
        .get('/platform-regulations/admin')
        .set('x-test-role', role)
        .expect(403)
      expect(sources.findAllAdmin).not.toHaveBeenCalled()
    }
  )

  it('lets admin create a valid source', async () => {
    await request(server)
      .post('/legal-sources/admin')
      .set('x-test-role', 'admin')
      .send(VALID_SOURCE)
      .expect(201)
    expect(sources.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'residence-law-2020' }),
      'user-1'
    )
  })

  it('rejects non-https externalUrl', async () => {
    await request(server)
      .post('/legal-sources/admin')
      .set('x-test-role', 'admin')
      .send({ ...VALID_SOURCE, externalUrl: 'http://vanban.chinhphu.vn/' })
      .expect(400)
    expect(sources.create).not.toHaveBeenCalled()
  })

  it('rejects changing key on update', async () => {
    await request(server)
      .patch('/legal-sources/admin/1.004194')
      .set('x-test-role', 'admin')
      .send({ key: 'other-key' })
      .expect(400)
    expect(sources.update).not.toHaveBeenCalled()
  })

  it('returns 409 with referencing regulation codes on delete', async () => {
    const res = await request(server)
      .delete('/legal-sources/admin/1.004194')
      .set('x-test-role', 'admin')
      .expect(409)
    const body = res.body as {
      error: { details: { code: string; regulationCodes: string[] } }
    }
    expect(body.error.details).toMatchObject({
      code: 'LEGAL_SOURCE_IN_USE',
      regulationCodes: ['REG-RES-01'],
    })
  })
})
