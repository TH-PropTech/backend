import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { UserPayload } from '../interfaces/auth.interface'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>
      user?: UserPayload
    }>()
    const authHeader = request.headers['authorization']

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token xác thực không hợp lệ')
    }

    const token = authHeader.split(' ')[1]

    if (!token) {
      throw new UnauthorizedException('Token xác thực không hợp lệ')
    }

    try {
      const payload = this.jwtService.verify<UserPayload>(token)
      request.user = payload
      return true
    } catch {
      throw new UnauthorizedException('Token đã hết hạn hoặc không hợp lệ')
    }
  }
}
