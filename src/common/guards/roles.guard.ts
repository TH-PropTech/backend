import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserPayload } from '../../modules/auth/interfaces/auth.interface';

/**
 * RolesGuard — kiểm tra user có ít nhất 1 role trong danh sách yêu cầu.
 *
 * Sử dụng:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('lender', 'admin')
 *   @Controller('invest')
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Lấy roles yêu cầu từ metadata (set bởi @Roles decorator)
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Nếu không có @Roles() → cho phép tất cả
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as UserPayload | undefined;

    if (!user) {
      throw new ForbiddenException('Bạn cần đăng nhập');
    }

    const userRoles: string[] = user.roles || [];
    const hasRole = requiredRoles.some(role =>
      userRoles.some((ur: string) => ur.toLowerCase() === role.toLowerCase()),
    );

    if (!hasRole) {
      throw new ForbiddenException(
        `Chức năng này chỉ dành cho: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}