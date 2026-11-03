import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'
import { HttpExceptionFilter } from './http-exception.filter'

interface Captured {
  status: number
  body: {
    success: boolean
    error: { code: string; message: string; details?: Record<string, unknown> }
  }
}

function run(
  exception: unknown,
  options: { url?: string; retryAfter?: string | number } = {}
): Captured {
  let captured: Captured | undefined
  const response = {
    status: (status: number): { json: (body: Captured['body']) => void } => ({
      json: (body: Captured['body']): void => {
        captured = { status, body }
      },
    }),
    getHeader: (name: string): string | number | undefined =>
      name.toLowerCase() === 'retry-after' ? options.retryAfter : undefined,
  }
  const request = {
    headers: {},
    originalUrl: options.url ?? '/api/v1/apartments',
  }
  const host = {
    switchToHttp: (): {
      getResponse: () => unknown
      getRequest: () => unknown
    } => ({
      getResponse: (): unknown => response,
      getRequest: (): unknown => request,
    }),
  } as unknown as ArgumentsHost

  new HttpExceptionFilter().catch(exception, host)
  if (!captured) throw new Error('filter did not respond')
  return captured
}

describe('HttpExceptionFilter rate limit response', () => {
  it('states the reason and the wait time in seconds', () => {
    const { status, body } = run(new ThrottlerException(), { retryAfter: 42 })

    expect(status).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(body.error.code).toBe('HTTP_429')
    expect(body.error.message).toBe(
      'Bạn thao tác quá nhanh. Vui lòng thử lại sau 42 giây.'
    )
    expect(body.error.details).toEqual({
      code: 'RATE_LIMITED',
      scope: 'global',
      retryAfterSeconds: 42,
    })
  })

  it('uses the auth wording and scope for login and OTP routes', () => {
    const { body } = run(new ThrottlerException(), {
      url: '/api/v1/auth/login?x=1',
      retryAfter: '30',
    })

    expect(body.error.message).toBe(
      'Bạn đã thử đăng nhập hoặc xác thực quá nhiều lần. Vui lòng thử lại sau 30 giây.'
    )
    expect(body.error.details).toMatchObject({
      scope: 'auth',
      retryAfterSeconds: 30,
    })
  })

  it('rounds a wait of one minute or more up to whole minutes', () => {
    expect(
      run(new ThrottlerException(), { retryAfter: 60 }).body.error.message
    ).toBe('Bạn thao tác quá nhanh. Vui lòng thử lại sau 1 phút.')
    expect(
      run(new ThrottlerException(), { retryAfter: 61 }).body.error.message
    ).toBe('Bạn thao tác quá nhanh. Vui lòng thử lại sau 2 phút.')
  })

  it('falls back to a generic wait and omits retryAfterSeconds without Retry-After', () => {
    const { body } = run(new ThrottlerException())

    expect(body.error.message).toBe(
      'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.'
    )
    expect(body.error.details).toEqual({
      code: 'RATE_LIMITED',
      scope: 'global',
    })
  })

  it('ignores an unusable Retry-After value', () => {
    const { body } = run(new ThrottlerException(), { retryAfter: 'abc' })

    expect(body.error.details).not.toHaveProperty('retryAfterSeconds')
  })

  it('leaves other errors unchanged', () => {
    const { status, body } = run(new BadRequestException('sai dữ liệu'))

    expect(status).toBe(HttpStatus.BAD_REQUEST)
    expect(body.error.code).toBe('HTTP_400')
    expect(body.error.message).toBe('sai dữ liệu')
  })
})
