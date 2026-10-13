import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import { Observable, tap } from 'rxjs'
import { ActivityLogService } from '../../modules/activity-log/services/activity-log.service'
import type { UserPayload } from '../../modules/auth/interfaces/auth.interface'

/** Chỉ ghi log các method ghi dữ liệu. */
const LOGGED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Chỉ ghi log thao tác của admin/staff (bỏ qua khách hàng). */
const LOGGED_ROLES = ['admin', 'staff']

const METHOD_LABEL: Record<string, string> = {
  POST: 'Tạo mới',
  PUT: 'Cập nhật',
  PATCH: 'Cập nhật',
  DELETE: 'Xóa',
}

type RequestLike = {
  method: string
  url: string
  body?: Record<string, unknown>
  ip?: string
  headers: Record<string, string | string[] | undefined>
  user?: UserPayload
}

type ResponseLike = { statusCode?: number }

function firstHeader(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

/**
 * Ghi nhật ký thao tác ghi dữ liệu (POST/PUT/PATCH/DELETE) của admin/staff vào DB.
 * Ghi theo kiểu fire-and-forget: lỗi ghi log không bao giờ ảnh hưởng response;
 * lỗi nghiệp vụ (exception) không được ghi vì đã có exception filter xử lý.
 */
@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('ActivityLog')

  constructor(private readonly activityLogService: ActivityLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle()

    const http = context.switchToHttp()
    const request = http.getRequest<RequestLike>()
    if (!LOGGED_METHODS.has(request.method)) return next.handle()

    const startedAt = Date.now()

    return next.handle().pipe(
      tap(responseBody => {
        const user = request.user
        const userRole = LOGGED_ROLES.find(role => user?.roles?.includes(role))
        if (!user || !userRole) return

        const path = request.url.split('?')[0] ?? request.url
        const response = http.getResponse<ResponseLike>()
        const message =
          responseBody && typeof responseBody === 'object'
            ? (responseBody as { message?: unknown }).message
            : undefined

        this.activityLogService
          .create({
            userId: user._id ?? 'unknown',
            userRole,
            method: request.method,
            path,
            action: `${METHOD_LABEL[request.method] ?? request.method} — ${path}`,
            ...(response.statusCode !== undefined && {
              statusCode: response.statusCode,
            }),
            ...(request.body && { requestBody: request.body }),
            responseMessage: typeof message === 'string' ? message : '',
            ip:
              firstHeader(request.headers['x-forwarded-for']) ||
              (request.ip ?? ''),
            userAgent: firstHeader(request.headers['user-agent']),
            duration: Date.now() - startedAt,
          })
          .catch((err: unknown) => {
            this.logger.error(
              'Ghi activity log thất bại',
              err instanceof Error ? err.stack : String(err)
            )
          })
      })
    )
  }
}
