import { ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler'

/**
 * ThrottlerGuard đăng ký global cho HTTP. Bỏ qua ngữ cảnh khác (WebSocket)
 * vì ThrottlerGuard mặc định chỉ hiểu request HTTP.
 * Lỗi hạ tầng (Redis) làm rate limit fail-open: cho request đi tiếp thay vì trả 5xx.
 */
// Sau lỗi storage, bỏ qua rate limit trong khoảng này để request không chờ timeout lặp lại.
const STORAGE_COOLDOWN_MS = 10_000

@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(HttpThrottlerGuard.name)
  private degradedUntil = 0

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true
    if (Date.now() < this.degradedUntil) return true
    try {
      return await super.canActivate(context)
    } catch (error) {
      if (error instanceof ThrottlerException) throw error
      this.degradedUntil = Date.now() + STORAGE_COOLDOWN_MS
      this.logger.warn(
        `Rate limit storage unavailable, allowing request: ${error instanceof Error ? error.message : String(error)}`
      )
      return true
    }
  }
}
