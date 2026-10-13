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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import {
  CreateRoleDto,
  SetPermissionsDto,
  UpdateRoleDto,
} from '../dto/rbac.dto'
import type { Permission } from '../schemas/permission.schema'
import type { Role } from '../schemas/role.schema'
import { RbacService } from '../services/rbac.service'

/** Quản trị role/permission lưu DB — chỉ Admin. */
@ApiTags('rbac')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('rbac')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('metadata')
  @ApiOperation({ summary: 'Danh sách action và subject hợp lệ' })
  getMetadata(): { actions: readonly string[]; subjects: readonly string[] } {
    return this.rbacService.getMetadata()
  }

  @Get('roles')
  @ApiOperation({ summary: 'Danh sách role' })
  listRoles(): Promise<Role[]> {
    return this.rbacService.listRoles()
  }

  @Get('roles/:id')
  @ApiOperation({ summary: 'Chi tiết role' })
  getRole(@Param('id') id: string): Promise<Role> {
    return this.rbacService.getRole(id)
  }

  @Post('roles')
  @ApiOperation({ summary: 'Tạo role mới' })
  createRole(@Body() dto: CreateRoleDto): Promise<Role> {
    return this.rbacService.createRole(dto)
  }

  @Patch('roles/:id')
  @ApiOperation({ summary: 'Cập nhật role' })
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto
  ): Promise<Role> {
    return this.rbacService.updateRole(id, dto)
  }

  @Delete('roles/:id')
  @ApiOperation({ summary: 'Xóa role tự tạo (không xóa role mặc định)' })
  deleteRole(@Param('id') id: string): Promise<{ deleted: true }> {
    return this.rbacService.deleteRole(id)
  }

  @Get('roles/:id/permissions')
  @ApiOperation({ summary: 'Quyền của một role' })
  getPermissions(@Param('id') id: string): Promise<Permission[]> {
    return this.rbacService.getPermissions(id)
  }

  @Put('roles/:id/permissions')
  @ApiOperation({ summary: 'Thay toàn bộ quyền của một role' })
  setPermissions(
    @Param('id') id: string,
    @Body() dto: SetPermissionsDto
  ): Promise<Permission[]> {
    return this.rbacService.setPermissions(id, dto.permissions)
  }
}
