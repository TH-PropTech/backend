import { CallHandler, ExecutionContext } from '@nestjs/common'
import { firstValueFrom, of, throwError } from 'rxjs'
import { ActivityLogService } from '../../modules/activity-log/services/activity-log.service'
import { ActivityLogInterceptor } from './activity-log.interceptor'

function buildContext(
  request: Record<string, unknown>,
  type = 'http'
): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode: 201 }),
    }),
  } as unknown as ExecutionContext
}

describe('ActivityLogInterceptor', () => {
  let create: jest.Mock
  let interceptor: ActivityLogInterceptor

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({})
    interceptor = new ActivityLogInterceptor({
      create,
    } as unknown as ActivityLogService)
  })

  const adminRequest = (
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    method: 'POST',
    url: '/api/v1/admin/rental-flow/profiles?x=1',
    body: { name: 'p', password: 'secret' },
    headers: { 'user-agent': 'jest', 'x-forwarded-for': '1.2.3.4' },
    user: { _id: 'u1', roles: ['admin'] },
    ...overrides,
  })

  it('logs a write request made by an admin', async () => {
    const handler: CallHandler = { handle: () => of({ message: 'ok' }) }
    await firstValueFrom(
      interceptor.intercept(buildContext(adminRequest()), handler)
    )

    expect(create).toHaveBeenCalledTimes(1)
    expect((create.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
      userId: 'u1',
      userRole: 'admin',
      method: 'POST',
      path: '/api/v1/admin/rental-flow/profiles',
      statusCode: 201,
      responseMessage: 'ok',
      ip: '1.2.3.4',
      userAgent: 'jest',
    })
  })

  it.each([
    ['GET request', adminRequest({ method: 'GET' })],
    [
      'non-staff user',
      adminRequest({ user: { _id: 'u2', roles: ['tenant'] } }),
    ],
    ['anonymous request', adminRequest({ user: undefined })],
  ])('does not log for %s', async (_label, request) => {
    const handler: CallHandler = { handle: () => of({}) }
    await firstValueFrom(interceptor.intercept(buildContext(request), handler))
    expect(create).not.toHaveBeenCalled()
  })

  it('skips non-http contexts', async () => {
    const handler: CallHandler = { handle: () => of({}) }
    await firstValueFrom(
      interceptor.intercept(buildContext(adminRequest(), 'ws'), handler)
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('does not log failed requests', async () => {
    const handler: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    }
    await expect(
      firstValueFrom(
        interceptor.intercept(buildContext(adminRequest()), handler)
      )
    ).rejects.toThrow('boom')
    expect(create).not.toHaveBeenCalled()
  })

  it('never fails the response when logging fails', async () => {
    create.mockRejectedValue(new Error('db down'))
    const handler: CallHandler = { handle: () => of({ ok: true }) }
    await expect(
      firstValueFrom(
        interceptor.intercept(buildContext(adminRequest()), handler)
      )
    ).resolves.toEqual({ ok: true })
  })
})
