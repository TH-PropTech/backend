import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
  HttpException,
} from '@nestjs/common'
import { Response, Request } from 'express'

interface CustomRequest extends Request {
  user?: {
    _id?: string
    sub?: string
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<CustomRequest>()

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR

    const message =
      exception instanceof Error ? exception.message : 'Internal server error'

    // Extract structured data from HttpException
    let data: Record<string, unknown> | undefined
    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse()
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resObj = exceptionResponse as Record<string, unknown>
        if (resObj.code) {
          const rest = { ...resObj }
          delete rest.message
          delete rest.statusCode
          delete rest.error
          data = rest
        }
      }
    }

    const xForwardedFor = request.headers['x-forwarded-for']
    const ip = Array.isArray(xForwardedFor)
      ? xForwardedFor[0]
      : xForwardedFor || request.ip || ''
    const userAgent = (request.headers['user-agent'] as string) || ''

    // Log with request details
    const logData = {
      message: `${request.method} ${request.url} - ${status} - ${message}`,
      method: request.method,
      url: request.url,
      statusCode: status,
      ip,
      userAgent,
      userId: request.user?._id || request.user?.sub || 'anonymous',
    }

    if (status >= 500) {
      this.logger.error(
        logData,
        exception instanceof Error ? exception.stack : undefined
      )
    } else {
      this.logger.warn(logData)
    }

    const errorResponse: Record<string, unknown> = {
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message:
        process.env.NODE_ENV === 'production' && status >= 500
          ? 'Internal server error'
          : message,
      error: exception instanceof Error ? exception.name : 'Error',
    }
    if (data) errorResponse.data = data

    response.status(status).json(errorResponse)
  }
}
