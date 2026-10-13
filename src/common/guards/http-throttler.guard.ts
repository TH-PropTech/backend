import { ExecutionContext, Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'

/**
 * ThrottlerGuard đăng ký global cho HTTP. Bỏ qua ngữ cảnh khác (WebSocket)
 * vì ThrottlerGuard mặc định chỉ hiểu request HTTP.
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  override canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return Promise.resolve(true)
    return super.canActivate(context)
  }
}
