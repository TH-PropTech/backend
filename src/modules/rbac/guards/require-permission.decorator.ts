import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common'
import {
  REQUIRE_PERMISSION_KEY,
  type ManagedRole,
  type PermissionAction,
  type PermissionSubject,
} from '../rbac.constants'
import { PermissionsGuard } from './permissions.guard'

/**
 * Yêu cầu quyền chi tiết (action trên subject) cho khách thuê, chủ nhà và nhân viên theo ma trận
 * phân quyền của admin. Admin luôn được. Đây là lớp thêm vào, không thay `@Roles` và kiểm tra chủ
 * sở hữu: route vẫn phải đi kèm `JwtAuthGuard` (global) và `@Roles(...)` như thường lệ.
 *
 * @param audience vai trò dùng route này, chỉ cần khi route không có `@Roles` (dùng để dựng bảng
 * phân quyền cho đúng, không ảnh hưởng việc chặn).
 */
export const RequirePermission = (
  action: PermissionAction,
  subject: PermissionSubject,
  audience?: readonly ManagedRole[]
): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(REQUIRE_PERMISSION_KEY, { action, subject, audience }),
    UseGuards(PermissionsGuard)
  )
