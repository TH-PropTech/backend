import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { RbacController } from './controllers/rbac.controller'
import { Role } from './schemas/role.schema'
import { RbacService } from './services/rbac.service'

/**
 * Cắt ngang: role (kèm quyền nhúng `permissions[]`) lưu DB + API quản trị. `RolesGuard` (common/)
 * vẫn đọc role từ JWT, không phụ thuộc module này.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Role])],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
