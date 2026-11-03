import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import type { ApiResponse } from '../interfaces/api-response.interface'

type RequestLike = {
  headers: Record<string, string | string[] | undefined>
  originalUrl?: string
  url?: string
}

type ResponseLike = {
  status: (code: number) => {
    json: (body: ApiResponse<never>) => void
  }
  getHeader?: (name: string) => unknown
}

import { Logger } from '@nestjs/common'

/** Nhóm hạn mức bị vượt, để client chọn câu chữ: `auth` là đăng nhập và OTP, còn lại là `global`. */
export type RateLimitScope = 'auth' | 'global'

const AUTH_ROUTE = /^\/api\/v\d+\/auth(\/|$)/

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const response = http.getResponse<ResponseLike>()
    const request = http.getRequest<RequestLike>()
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR

    if (Number(status) === Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        'Unhandled Server Exception:',
        exception instanceof Error ? exception.stack : exception
      )
    }

    const errorBody = toErrorBody(exception, status, request, response)

    response.status(status).json({
      success: false,
      data: null,
      error: errorBody,
      meta: buildMeta(request),
    })
  }
}

function buildMeta(request: RequestLike): {
  requestId?: string
  timestamp: string
} {
  const requestId = normalizeHeader(request.headers['x-request-id'])
  const meta = {
    timestamp: new Date().toISOString(),
  }

  return requestId === undefined ? meta : { ...meta, requestId }
}

/**
 * Mô hình lỗi 429 dùng chung cho web và mobile: `error.code` giữ `HTTP_429`, mã ổn định
 * nằm ở `details.code` (như các lỗi nghiệp vụ khác), kèm số giây phải chờ và nhóm hạn mức.
 */
function toRateLimitBody(
  request: RequestLike,
  response: ResponseLike
): { code: string; message: string; details: Record<string, unknown> } {
  const scope = readRateLimitScope(request)
  const retryAfterSeconds = readRetryAfterSeconds(response)

  return {
    code: 'HTTP_429',
    message: buildRateLimitMessage(scope, retryAfterSeconds),
    details: {
      code: 'RATE_LIMITED',
      scope,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  }
}

function readRateLimitScope(request: RequestLike): RateLimitScope {
  const path = (request.originalUrl ?? request.url ?? '').split('?')[0] ?? ''
  return AUTH_ROUTE.test(path) ? 'auth' : 'global'
}

function readRetryAfterSeconds(response: ResponseLike): number | undefined {
  const raw: unknown = response.getHeader?.('Retry-After')
  const value: unknown = Array.isArray(raw) ? (raw[0] as unknown) : raw
  const seconds = Math.ceil(Number(value))
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} giây`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} phút`
}

function buildRateLimitMessage(
  scope: RateLimitScope,
  retryAfterSeconds: number | undefined
): string {
  const reason =
    scope === 'auth'
      ? 'Bạn đã thử đăng nhập hoặc xác thực quá nhiều lần.'
      : 'Bạn thao tác quá nhanh.'
  const wait =
    retryAfterSeconds === undefined
      ? 'Vui lòng thử lại sau ít phút.'
      : `Vui lòng thử lại sau ${formatWait(retryAfterSeconds)}.`
  return `${reason} ${wait}`
}

function toErrorBody(
  exception: unknown,
  status: number,
  request: RequestLike,
  httpResponse: ResponseLike
): { code: string; message: string; details?: unknown } {
  if (exception instanceof HttpException) {
    if (Number(status) === Number(HttpStatus.TOO_MANY_REQUESTS)) {
      return toRateLimitBody(request, httpResponse)
    }
    const response = exception.getResponse()

    if (typeof response === 'object' && response !== null) {
      const body = response as Record<string, unknown>

      return {
        code: `HTTP_${status}`,
        message: readMessage(body.message) ?? exception.message,
        details: body,
      }
    }

    return {
      code: `HTTP_${status}`,
      message: String(response),
    }
  }

  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unexpected server error',
  }
}

function readMessage(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0]
  }

  return undefined
}

function normalizeHeader(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
