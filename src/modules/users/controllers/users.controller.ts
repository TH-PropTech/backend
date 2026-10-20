import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { User } from '../schemas/user.schema'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { UpdateUserPermissionsDto } from '../dto/update-user-permissions.dto'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'

/** Bỏ `smartOTP.devices` (publicKey/deviceId nhạy cảm) khỏi phản hồi; giữ phần còn lại. */
function withoutSmartOtpDevices(
  smartOTP: User['smartOTP']
): Record<string, unknown> {
  if (!smartOTP) return {}
  const { devices, ...rest } = smartOTP
  void devices
  return { smartOTP: rest }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>
  ) {}

  /**
   * Lấy thông tin profile đầy đủ của người dùng hiện tại
   * Loại bỏ các trường nhạy cảm (passwordHash, pin.hash, twoFactor.secret)
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(
    @Request() req: { user: { _id: string } }
  ): Promise<Partial<User>> {
    const userId = req.user._id
    const user = await this.userRepository.findOne({
      where: { _id: new ObjectId(userId) },
    })

    if (!user) {
      throw new Error('Tài khoản không tồn tại')
    }

    // Loại bỏ các trường nhạy cảm trước khi trả về
    const { passwordHash, pin, twoFactor, smartOTP, ...safeUser } = user

    // Trả về pin status thay vì pin hash
    const result: Record<string, unknown> = {
      ...safeUser,
      ...withoutSmartOtpDevices(smartOTP),
      hasPin: !!pin?.hash,
      pinSetAt: pin?.setAt || null,
      twoFactorEnabled: twoFactor?.enabled || false,
      twoFactorEnabledAt: twoFactor?.enabledAt || null,
    }

    // Suppress unused variable warnings
    void passwordHash

    return result
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAll(): Promise<Partial<User>[]> {
    const users = await this.userRepository.find()
    return users.map(user => {
      const { passwordHash, pin, twoFactor, smartOTP, ...safeUser } = user
      void passwordHash
      return {
        ...safeUser,
        ...withoutSmartOtpDevices(smartOTP),
        hasPin: !!pin?.hash,
        twoFactorEnabled: twoFactor?.enabled || false,
      }
    })
  }

  /**
   * Cập nhật ma trận phân quyền cho user theo role
   * Admin chỉ định permission matrix cho một user/role cụ thể
   * Permissions được lưu vào metadata.permissions
   * [uc_admin_rbac]
   */
  @ApiOperation({ summary: 'Admin cập nhật permission matrix cho user' })
  @Patch(':id/permissions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateUserPermissionsDto
  ): Promise<{
    success: boolean
    userId: string
    permissions: Record<string, boolean>
  }> {
    let objectId: ObjectId
    try {
      objectId = new ObjectId(id)
    } catch {
      throw new NotFoundException('Người dùng không tồn tại')
    }

    const user = await this.userRepository.findOne({
      where: { _id: objectId },
    })

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại')
    }

    const updatedMetadata: Record<string, unknown> = {
      ...(user.metadata ?? {}),
      permissions: dto.permissions,
    }

    // Ghi từng trường (không save toàn document) để không ghi đè smartOTP.devices
    await this.userRepository.update(user._id, {
      metadata: updatedMetadata as never,
      updatedAt: new Date(),
    })

    return {
      success: true,
      userId: id,
      permissions: dto.permissions,
    }
  }

  /**
   * Admin cập nhật role của user
   * [uc_admin_rbac]
   */
  @ApiOperation({ summary: 'Admin cập nhật role của user' })
  @Patch(':id/role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateRole(
    @Param('id') id: string,
    @Body('role') role: 'tenant' | 'landlord' | 'staff' | 'admin'
  ): Promise<{ success: boolean; userId: string; role: string }> {
    let objectId: ObjectId
    try {
      objectId = new ObjectId(id)
    } catch {
      throw new NotFoundException('Người dùng không tồn tại')
    }

    const user = await this.userRepository.findOne({
      where: { _id: objectId },
    })

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại')
    }

    // Ghi từng trường (không save toàn document) để không ghi đè smartOTP.devices.
    // Đổi vai trò gốc thì bỏ vai trò tùy chỉnh (nó chỉ hợp lệ với đúng vai trò gốc cũ).
    await this.userRepository.update(user._id, {
      role,
      ...(user.role !== role ? { permissionProfile: null } : {}),
      updatedAt: new Date(),
    })

    return { success: true, userId: id, role }
  }
}
