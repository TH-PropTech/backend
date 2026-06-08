import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable, map } from 'rxjs'
import type { ApiResponse } from '../interfaces/api-response.interface'

type RequestLike = {
  headers: Record<string, string | string[] | undefined>
}

@Injectable()
export class ResponseEnvelopeInterceptor<TData> implements NestInterceptor<
  TData,
  ApiResponse<TData>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<TData>
  ): Observable<ApiResponse<TData>> {
    const request = context.switchToHttp().getRequest<RequestLike>()

    return next.handle().pipe(
      map(data => ({
        success: true,
        data,
        error: null,
        meta: buildMeta(request),
      }))
    )
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

function normalizeHeader(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
