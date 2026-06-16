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
}

type ResponseLike = {
  status: (code: number) => {
    json: (body: ApiResponse<never>) => void
  }
}

import { Logger } from '@nestjs/common'

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

    const errorBody = toErrorBody(exception, status)

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

function toErrorBody(
  exception: unknown,
  status: number
): { code: string; message: string; details?: unknown } {
  if (exception instanceof HttpException) {
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
