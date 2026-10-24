import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { DiscoveryService } from '@nestjs/core'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import {
  CreateRoleDto,
  SetPermissionsDto,
  SetRoleUsersDto,
  UpdateRoleDto,
} from '../dto/rbac.dto'
import {
  buildPermissionSchema,
  type PermissionSchema,
} from '../utils/permission-schema'
import type { RolePermissionView, RoleView } from '../schemas/role.schema'
import { RbacService } from '../services/rbac.service'

/** Quản trị role/permission lưu DB — chỉ Admin. */
@ApiTags('rbac')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('rbac')
export class RbacController {
  private schema: PermissionSchema | null = null

  constructor(
    private readonly rbacService: RbacService,
    private readonly discovery: DiscoveryService
  ) {}

  /**
   * Bảng thao tác mà từng vai trò có thể bật/tắt, dựng từ các route đã gắn `@RequirePermission`
   * để giao diện phân quyền không bao giờ lệch với việc backend thật sự chặn.
   */
  @Get('permission-schema')
  @ApiOperation({ summary: 'Các thao tác phân quyền được theo từng vai trò' })
  getPermissionSchema(): PermissionSchema {
    this.schema ??= buildPermissionSchema(
      this.discovery
        .getControllers()
        .flatMap(wrapper => (wrapper.metatype ? [wrapper.metatype] : []))
        .map(type => type as unknown as new (...args: never[]) => unknown)
    )
    return this.schema
  }

  @Get('metadata')
  @ApiOperation({ summary: 'Danh sách action và subject hợp lệ' })
  getMetadata(): { actions: readonly string[]; subjects: readonly string[] } {
    return this.rbacService.getMetadata()
  }

  /** Bảng quyền hiệu lực của người đang đăng nhập, để giao diện ẩn nút không dùng được. */
  @Get('me/permissions')
  @Roles('tenant', 'landlord', 'staff', 'admin')
  @ApiOperation({ summary: 'Quyền hiệu lực của tôi' })
  async myPermissions(
    @CurrentUser() user: UserPayload
  ): Promise<{ isAdmin: boolean; permissions: Record<string, boolean> }> {
    const roles = (user.roles ?? []).map(r => r.toLowerCase())
    const isAdmin = roles.includes('admin')
    return {
      isAdmin,
      permissions: await this.rbacService.effectivePermissions(
        roles,
        isAdmin,
        user._id
      ),
    }
  }

  @Get('roles')
  @ApiOperation({ summary: 'Danh sách role' })
  listRoles(): Promise<RoleView[]> {
    return this.rbacService.listRoles()
  }

  @Get('roles/:id')
  @ApiOperation({ summary: 'Chi tiết role' })
  getRole(@Param('id') id: string): Promise<RoleView> {
    return this.rbacService.getRole(id)
  }

  @Post('roles')
  @ApiOperation({ summary: 'Tạo role mới' })
  createRole(@Body() dto: CreateRoleDto): Promise<RoleView> {
    return this.rbacService.createRole(dto)
  }

  @Patch('roles/:id')
  @ApiOperation({ summary: 'Cập nhật role' })
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto
  ): Promise<RoleView> {
    return this.rbacService.updateRole(id, dto)
  }

  @Delete('roles/:id')
  @ApiOperation({ summary: 'Xóa role tự tạo (không xóa role mặc định)' })
  deleteRole(@Param('id') id: string): Promise<{ deleted: true }> {
    return this.rbacService.deleteRole(id)
  }

  @Put('roles/:id/users')
  @ApiOperation({
    summary:
      'Đặt danh sách người dùng của vai trò tùy chỉnh (thay toàn bộ danh sách hiện có)',
  })
  setRoleUsers(
    @Param('id') id: string,
    @Body() dto: SetRoleUsersDto
  ): Promise<{ assigned: number; removed: number }> {
    return this.rbacService.setRoleUsers(id, dto.userIds)
  }

  @Get('roles/:id/permissions')
  @ApiOperation({ summary: 'Quyền của một role' })
  getPermissions(@Param('id') id: string): Promise<RolePermissionView[]> {
    return this.rbacService.getPermissions(id)
  }

  @Put('roles/:id/permissions')
  @ApiOperation({ summary: 'Thay toàn bộ quyền của một role' })
  setPermissions(
    @Param('id') id: string,
    @Body() dto: SetPermissionsDto
  ): Promise<RolePermissionView[]> {
    return this.rbacService.setPermissions(id, dto.permissions)
  }
}
