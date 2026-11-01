import {
  Controller,
  Get,
  Patch,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  NotFoundException,
  BadRequestException,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { User } from '../schemas/user.schema'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { UpdateUserPermissionsDto } from '../dto/update-user-permissions.dto'
import { UpdateUserProfileDto } from '../dto/update-user-profile.dto'
import { NotificationPreferencesDto } from '../dto/notification-preferences.dto'
import { SessionListResponseDto } from '../dto/session-response.dto'
import { UsersService } from '../services/users.service'
import { SessionsService } from '../../auth/services/sessions.service'
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger'

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
    private readonly userRepository: Repository<User>,
    @Optional()
    private readonly usersService?: UsersService,
    @Optional()
    private readonly sessionsService?: SessionsService
  ) {}

  private getEffectiveUsersService(): UsersService {
    return (
      this.usersService ??
      new UsersService(this.userRepository, this.sessionsService)
    )
  }

  /**
   * Lấy thông tin profile đầy đủ của người dùng hiện tại
   * Loại bỏ các trường nhạy cảm (passwordHash, pin.hash, twoFactor.secret)
   */
  @ApiOperation({ summary: 'Lấy thông tin tài khoản của người dùng hiện tại' })
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(
    @Request() req: { user: { _id: string } }
  ): Promise<Record<string, unknown>> {
    const userId = req.user._id
    const user = await this.userRepository.findOne({
      where: { _id: new ObjectId(userId) },
    })

    if (!user) {
      throw new NotFoundException('Tài khoản không tồn tại')
    }

    const { passwordHash, pin, twoFactor, smartOTP, ...safeUser } = user
    void passwordHash

    return {
      ...safeUser,
      ...(smartOTP ? withoutSmartOtpDevices(smartOTP) : {}),
      hasPin: !!pin?.hash,
      pinSetAt: pin?.setAt || null,
      twoFactorEnabled: twoFactor?.enabled || false,
      twoFactorEnabledAt: twoFactor?.enabledAt || null,
    }
  }

  /**
   * Cập nhật thông tin hồ sơ người dùng (họ và tên, số điện thoại)
   * Không cho phép sửa email hoặc số định danh
   */
  @ApiOperation({ summary: 'Cập nhật hồ sơ cá nhân' })
  @ApiResponse({ status: 200, description: 'Cập nhật hồ sơ thành công' })
  @ApiResponse({
    status: 400,
    description: 'Dữ liệu không hợp lệ hoặc cố sửa trường cấm',
  })
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateMe(
    @Request() req: { user: { _id: string } },
    @Body() dto: UpdateUserProfileDto
  ): Promise<Record<string, unknown>> {
    const raw = dto as Record<string, unknown>
    if ('email' in raw || 'idCardNumber' in raw) {
      throw new BadRequestException(
        'Không được phép chỉnh sửa email hoặc số định danh qua endpoint này'
      )
    }
    return this.getEffectiveUsersService().updateProfile(req.user._id, dto)
  }

  /**
   * Lấy tùy chọn kênh thông báo của người dùng
   */
  @ApiOperation({ summary: 'Lấy tùy chọn kênh thông báo' })
  @Get('me/notification-preferences')
  @UseGuards(JwtAuthGuard)
  async getNotificationPreferences(
    @Request() req: { user: { _id: string } }
  ): Promise<NotificationPreferencesDto> {
    return this.getEffectiveUsersService().getNotificationPreferences(
      req.user._id
    )
  }

  /**
   * Cập nhật tùy chọn kênh thông báo của người dùng
   */
  @ApiOperation({ summary: 'Cập nhật tùy chọn kênh thông báo' })
  @ApiResponse({ status: 200, type: NotificationPreferencesDto })
  @Put('me/notification-preferences')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateNotificationPreferences(
    @Request() req: { user: { _id: string } },
    @Body() dto: NotificationPreferencesDto
  ): Promise<NotificationPreferencesDto> {
    return this.getEffectiveUsersService().updateNotificationPreferences(
      req.user._id,
      dto
    )
  }

  /**
   * Lấy danh sách phiên đăng nhập đang hoạt động
   */
  @ApiOperation({ summary: 'Lấy danh sách phiên đăng nhập của người dùng' })
  @ApiResponse({ status: 200, type: SessionListResponseDto })
  @Get('me/sessions')
  @UseGuards(JwtAuthGuard)
  async getSessions(
    @Request()
    req: {
      user: { _id: string; sessionId?: string }
      headers?: Record<string, string>
    }
  ): Promise<SessionListResponseDto> {
    const currentSessionId =
      req.user?.sessionId || req.headers?.['x-session-id']
    return this.getEffectiveUsersService().getUserSessions(
      req.user._id,
      currentSessionId
    )
  }

  /**
   * Thu hồi một phiên đăng nhập khác của người dùng
   */
  @ApiOperation({ summary: 'Thu hồi phiên đăng nhập khác' })
  @ApiResponse({ status: 204, description: 'Đã thu hồi phiên thành công' })
  @ApiResponse({ status: 400, description: 'Không thể thu hồi phiên hiện tại' })
  @ApiResponse({
    status: 404,
    description: 'Phiên không tồn tại hoặc thuộc người khác',
  })
  @Delete('me/sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async revokeSession(
    @Param('id') id: string,
    @Request()
    req: {
      user: { _id: string; sessionId?: string }
      headers?: Record<string, string>
    }
  ): Promise<void> {
    const currentSessionId =
      req.user?.sessionId || req.headers?.['x-session-id']
    await this.getEffectiveUsersService().revokeSession(
      req.user._id,
      id,
      currentSessionId
    )
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
