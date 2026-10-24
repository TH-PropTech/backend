import {
  Controller,
  Get,
  Global,
  INestApplication,
  Module,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { RequirePermission } from './require-permission.decorator'
import { RbacService } from '../services/rbac.service'

/**
 * Chứng minh đường đi thật qua Nest: `@RequirePermission` ở một module bất kỳ tự lấy được
 * `RbacService` từ module global, guard chạy sau khi có `req.user`, và trả 403 kèm mã ổn định.
 */
const roleCan = jest.fn()

@Global()
@Module({
  providers: [{ provide: RbacService, useValue: { roleCan } }],
  exports: [RbacService],
})
class FakeRbacModule {}

@Controller('probe')
class ProbeController {
  @Get('approve-kyc')
  @RequirePermission('approve', 'Kyc')
  approveKyc(): { ok: boolean } {
    return { ok: true }
  }

  @Get('open')
  open(): { ok: boolean } {
    return { ok: true }
  }
}

@Module({ controllers: [ProbeController] })
class FeatureModule {}

describe('@RequirePermission over HTTP', () => {
  let app: INestApplication
  let roles: string[]
  const server = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0]

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeRbacModule, FeatureModule],
    }).compile()
    app = moduleRef.createNestApplication()
    app.use(
      (
        req: { user?: { roles: string[] } },
        _res: unknown,
        next: () => void
      ) => {
        req.user = { roles }
        next()
      }
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    roleCan.mockReset()
    roles = ['staff']
  })

  it('staff is blocked with 403 and a stable code when the switch is off', async () => {
    roleCan.mockResolvedValue(false)
    const res = await request(server()).get('/probe/approve-kyc')
    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(roleCan).toHaveBeenCalledWith(['staff'], 'approve', 'Kyc', undefined)
  })

  it('staff passes when the switch is on', async () => {
    roleCan.mockResolvedValue(true)
    const res = await request(server()).get('/probe/approve-kyc')
    expect(res.status).toBe(200)
  })

  it('admin passes without consulting the policy', async () => {
    roles = ['admin']
    roleCan.mockResolvedValue(false)
    const res = await request(server()).get('/probe/approve-kyc')
    expect(res.status).toBe(200)
    expect(roleCan).not.toHaveBeenCalled()
  })

  it('routes without the decorator are untouched', async () => {
    roleCan.mockResolvedValue(false)
    const res = await request(server()).get('/probe/open')
    expect(res.status).toBe(200)
    expect(roleCan).not.toHaveBeenCalled()
  })
})
