import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { UserPayload } from '../../modules/auth/interfaces/auth.interface'

export const CurrentUser = createParamDecorator(
  (data: keyof UserPayload | 'id' | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: UserPayload }>()
    const user = request.user
    if (!user) return null

    if (data === 'id') {
      const u = user as unknown as Record<string, unknown>
      return user._id ?? u.sub ?? u.userId ?? u.id
    }

    return data ? user[data] : user
  }
)
