import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof Error ? exception.message : 'Internal server error';

    // Extract structured data from HttpException (debtGroup, overdueDays, policy...)
    let data: Record<string, any> | undefined;
    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object' && (exceptionResponse as any).code) {
        const { message: _msg, statusCode: _s, error: _e, ...rest } = exceptionResponse as any;
        data = rest;
      }
    }

    // Log with request details
    const logData = {
      message: `${request.method} ${request.url} - ${status} - ${message}`,
      method: request.method,
      url: request.url,
      statusCode: status,
      ip: request.headers['x-forwarded-for'] || request.ip || '',
      userAgent: request.headers['user-agent'] || '',
      userId: request.user?._id || request.user?.sub || 'anonymous',
    };

    if (status >= 500) {
      this.logger.error(logData, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(logData);
    }

    const errorResponse: Record<string, any> = {
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: process.env.NODE_ENV === 'production' && status >= 500 ? 'Internal server error' : message,
      error: exception instanceof Error ? exception.name : 'Error',
    };
    if (data) errorResponse.data = data;

    response.status(status).json(errorResponse);
  }
}