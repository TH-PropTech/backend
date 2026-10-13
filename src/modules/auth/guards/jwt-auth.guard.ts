import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator'
import { UserPayload } from '../interfaces/auth.interface'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Guard đăng ký global: WebSocket tự xác thực trong gateway, không đi qua guard HTTP
    if (context.getType() !== 'http') return true

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>
      user?: UserPayload
    }>()
    const authHeader = request.headers['authorization']

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (isPublic) return true
      throw new UnauthorizedException('Token xác thực không hợp lệ')
    }

    const token = authHeader.split(' ')[1]

    if (!token) {
      if (isPublic) return true
      throw new UnauthorizedException('Token xác thực không hợp lệ')
    }

    try {
      const payload = this.jwtService.verify<UserPayload>(token)
      request.user = payload
      return true
    } catch {
      if (isPublic) return true
      throw new UnauthorizedException('Token đã hết hạn hoặc không hợp lệ')
    }
  }
}
