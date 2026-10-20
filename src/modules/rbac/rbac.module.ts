import { Global, Module } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import { RbacController } from './controllers/rbac.controller'
import { PermissionsGuard } from './guards/permissions.guard'
import { User } from '../users/schemas/user.schema'
import { Role } from './schemas/role.schema'
import { RbacService } from './services/rbac.service'

/**
 * Cắt ngang: role (kèm quyền nhúng `permissions[]`) lưu DB + API quản trị. `RolesGuard` (common/)
 * vẫn đọc role từ JWT, không phụ thuộc module này. Global để `PermissionsGuard` (gắn qua
 * `@RequirePermission` ở controller của các module khác) lấy được `RbacService`.
 */
@Global()
@Module({
  imports: [DiscoveryModule, TypeOrmModule.forFeature([Role, User])],
  controllers: [RbacController],
  providers: [RbacService, PermissionsGuard],
  exports: [RbacService, PermissionsGuard],
})
export class RbacModule {}
