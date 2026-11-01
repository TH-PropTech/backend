import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { User, DEFAULT_NOTIFICATION_PREFERENCES } from '../schemas/user.schema'
import { UpdateUserProfileDto } from '../dto/update-user-profile.dto'
import { NotificationPreferencesDto } from '../dto/notification-preferences.dto'
import {
  SessionListResponseDto,
  SessionItemDto,
} from '../dto/session-response.dto'
import { SessionsService, maskIp } from '../../auth/services/sessions.service'

/** Bỏ `smartOTP.devices` khỏi phản hồi; giữ phần còn lại */
function withoutSmartOtpDevices(
  smartOTP: User['smartOTP']
): Record<string, unknown> {
  if (!smartOTP) return {}
  const { devices, ...rest } = smartOTP
  void devices
  return { smartOTP: rest }
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Optional()
    private readonly sessionsService?: SessionsService
  ) {}

  async getMe(userId: string): Promise<Record<string, unknown>> {
    let objectId: ObjectId
    try {
      objectId = new ObjectId(userId)
    } catch {
      throw new NotFoundException('Tài khoản không tồn tại')
    }

    const user = await this.userRepository.findOne({
      where: { _id: objectId },
    })

    if (!user) {
      throw new NotFoundException('Tài khoản không tồn tại')
    }

    const { passwordHash, pin, twoFactor, smartOTP, ...safeUser } = user
    void passwordHash

    return {
      ...safeUser,
      ...(smartOTP ? withoutSmartOtpDevices(smartOTP) : {}),
      notificationPreferences:
        user.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES,
      hasPin: !!pin?.hash,
      pinSetAt: pin?.setAt || null,
      twoFactorEnabled: twoFactor?.enabled || false,
      twoFactorEnabledAt: twoFactor?.enabledAt || null,
    }
  }

  async updateProfile(
    userId: string,
    dto: UpdateUserProfileDto
  ): Promise<Record<string, unknown>> {
    let objectId: ObjectId
    try {
      objectId = new ObjectId(userId)
    } catch {
      throw new NotFoundException('Tài khoản không tồn tại')
    }

    const user = await this.userRepository.findOne({
      where: { _id: objectId },
    })

    if (!user) {
      throw new NotFoundException('Tài khoản không tồn tại')
    }

    // Nếu sửa số điện thoại, kiểm tra xem số đó đã có tài khoản khác dùng chưa
    if (dto.phone && dto.phone !== user.phone) {
      const existing = await this.userRepository.findOne({
        where: { phone: dto.phone },
      })
      if (existing && existing._id.toString() !== user._id.toString()) {
        throw new BadRequestException(
          'Số điện thoại đã được sử dụng bởi tài khoản khác'
        )
      }
    }

    const updateData: Partial<User> = {
      updatedAt: new Date(),
    }
    if (dto.fullName !== undefined) {
      updateData.fullName = dto.fullName
    }
    if (dto.phone !== undefined) {
      updateData.phone = dto.phone
    }

    await this.userRepository.update(user._id, updateData as never)

    return this.getMe(userId)
  }

  async getNotificationPreferences(
    userId: string
  ): Promise<NotificationPreferencesDto> {
    let objectId: ObjectId
    try {
      objectId = new ObjectId(userId)
    } catch {
      throw new NotFoundException('Tài khoản không tồn tại')
    }

    const user = await this.userRepository.findOne({
      where: { _id: objectId },
    })

    if (!user) {
      throw new NotFoundException('Tài khoản không tồn tại')
    }

    return {
      email:
        user.notificationPreferences?.email ??
        DEFAULT_NOTIFICATION_PREFERENCES.email,
      push:
        user.notificationPreferences?.push ??
        DEFAULT_NOTIFICATION_PREFERENCES.push,
    }
  }

  async updateNotificationPreferences(
    userId: string,
    dto: NotificationPreferencesDto
  ): Promise<NotificationPreferencesDto> {
    let objectId: ObjectId
    try {
      objectId = new ObjectId(userId)
    } catch {
      throw new NotFoundException('Tài khoản không tồn tại')
    }

    const user = await this.userRepository.findOne({
      where: { _id: objectId },
    })

    if (!user) {
      throw new NotFoundException('Tài khoản không tồn tại')
    }

    const preferences: NotificationPreferencesDto = {
      email: dto.email,
      push: dto.push,
    }

    await this.userRepository.update(user._id, {
      notificationPreferences: preferences,
      updatedAt: new Date(),
    })

    return preferences
  }

  async getUserSessions(
    userId: string,
    currentSessionId?: string
  ): Promise<SessionListResponseDto> {
    if (!this.sessionsService) {
      return { items: [] }
    }

    const sessions =
      await this.sessionsService.findActiveSessionsByUserId(userId)

    const items: SessionItemDto[] = sessions.map(s => {
      const id = s._id.toString()
      return {
        id,
        deviceLabel: s.deviceLabel,
        ipMasked: maskIp(s.ip),
        lastActiveAt: s.lastActiveAt,
        isCurrent: currentSessionId ? id === currentSessionId : false,
      }
    })

    return { items }
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    currentSessionId?: string
  ): Promise<void> {
    if (currentSessionId && currentSessionId === sessionId) {
      throw new BadRequestException(
        'Không thể thu hồi phiên hiện tại qua endpoint này. Vui lòng sử dụng chức năng đăng xuất.'
      )
    }

    if (!this.sessionsService) {
      throw new NotFoundException('Phiên đăng nhập không tồn tại')
    }

    const success = await this.sessionsService.revokeSession(userId, sessionId)
    if (!success) {
      throw new NotFoundException(
        'Phiên đăng nhập không tồn tại hoặc không thuộc về tài khoản này'
      )
    }
  }
}
