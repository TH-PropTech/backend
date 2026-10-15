import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { MongoRepository } from 'typeorm'
import { createHash } from 'crypto'
import { ObjectId } from 'mongodb'
import { User, type DeviceBindingInfo } from '../../users/schemas/user.schema'
import { DeviceBinding } from '../schemas/device-binding.schema'
import { DeviceStatus } from '../enums/device-status.enum'

const DEVICES_PATH = 'smartOTP.devices'
const MAX_BIND_ATTEMPTS = 3

/**
 * Thiết bị Smart OTP nay được nhúng trong `users.smartOTP.devices[]`.
 * Mọi thao tác ghi dùng toán tử nguyên tử trên một document user
 * ($push có điều kiện / $set vị trí), không `save(User)` toàn document.
 * Chữ ký công khai và hình dạng giá trị trả về (DeviceBinding) giữ nguyên.
 */
@Injectable()
export class DeviceBindingService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: MongoRepository<User>
  ) {}

  /**
   * Đăng ký liên kết thiết bị mới
   */
  async bindDevice(
    userId: string,
    deviceId: string,
    deviceName: string,
    publicKey: string
  ): Promise<DeviceBinding> {
    const oid = this.toObjectId(userId)
    if (!oid) {
      throw new BadRequestException('Mã người dùng không hợp lệ')
    }

    await this.ensureSmartOtpContainer(oid)

    for (let attempt = 0; attempt < MAX_BIND_ATTEMPTS; attempt += 1) {
      const existing = await this.findEmbedded(oid, deviceId)

      if (existing) {
        if ((existing.status as DeviceStatus) === DeviceStatus.BLOCKED) {
          throw new BadRequestException('Thiết bị này đã bị khóa trên hệ thống')
        }
        // Cập nhật lại thông tin mới (chỉ khi thiết bị chưa bị khóa)
        const result = await this.userRepository.updateOne(
          {
            _id: oid,
            [DEVICES_PATH]: {
              $elemMatch: {
                deviceId,
                status: { $ne: DeviceStatus.BLOCKED },
              },
            },
          },
          {
            $set: {
              [`${DEVICES_PATH}.$.deviceName`]: deviceName,
              [`${DEVICES_PATH}.$.publicKey`]: publicKey,
              [`${DEVICES_PATH}.$.status`]: DeviceStatus.ACTIVE,
              [`${DEVICES_PATH}.$.updatedAt`]: new Date(),
            },
          }
        )
        if (matched(result)) {
          return this.requireMapped(userId, oid, deviceId)
        }
        continue // bị khóa/xóa đồng thời: đọc lại để quyết định
      }

      // Tạo mới: chỉ $push khi chưa có deviceId trong mảng
      const now = new Date()
      const entry: DeviceBindingInfo = {
        bindingId: new ObjectId(),
        deviceId,
        deviceName,
        publicKey,
        status: DeviceStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
      }
      const result = await this.userRepository.updateOne(
        { _id: oid, [`${DEVICES_PATH}.deviceId`]: { $ne: deviceId } },
        {
          $push: { [DEVICES_PATH]: entry } as never,
          $inc: { 'smartOTP.registeredDevices': 1 },
        }
      )
      if (matched(result)) {
        return this.toBinding(userId, entry)
      }
      // Không khớp: user không tồn tại, hoặc luồng khác vừa thêm cùng deviceId
      if (!(await this.userExists(oid))) {
        throw new NotFoundException('Không tìm thấy tài khoản người dùng')
      }
    }

    throw new BadRequestException(
      'Không thể liên kết thiết bị, vui lòng thử lại'
    )
  }

  /**
   * Lấy liên kết thiết bị cụ thể
   */
  async getDeviceBinding(
    userId: string,
    deviceId: string
  ): Promise<DeviceBinding | null> {
    const oid = this.toObjectId(userId)
    if (!oid) return null
    const device = await this.findEmbedded(oid, deviceId)
    return device ? this.toBinding(userId, device) : null
  }

  /**
   * Lấy danh sách thiết bị liên kết của user
   */
  async getUserDevices(userId: string): Promise<DeviceBinding[]> {
    const oid = this.toObjectId(userId)
    if (!oid) return []
    const user = await this.userRepository.findOne({
      where: { _id: oid },
      select: ['smartOTP'],
    })
    return (user?.smartOTP?.devices ?? []).map(d => this.toBinding(userId, d))
  }

  /**
   * Khóa thiết bị
   */
  async blockDevice(userId: string, deviceId: string): Promise<void> {
    await this.setStatus(userId, deviceId, DeviceStatus.BLOCKED)
  }

  /**
   * Kích hoạt thiết bị
   */
  async activateDevice(userId: string, deviceId: string): Promise<void> {
    await this.setStatus(userId, deviceId, DeviceStatus.ACTIVE)
  }

  private async setStatus(
    userId: string,
    deviceId: string,
    status: DeviceStatus
  ): Promise<void> {
    const oid = this.toObjectId(userId)
    const result = oid
      ? await this.userRepository.updateOne(
          { _id: oid, [`${DEVICES_PATH}.deviceId`]: deviceId },
          {
            $set: {
              [`${DEVICES_PATH}.$.status`]: status,
              [`${DEVICES_PATH}.$.updatedAt`]: new Date(),
            },
          }
        )
      : null
    if (!result || !matched(result)) {
      throw new NotFoundException('Không tìm thấy thiết bị liên kết')
    }
  }

  /**
   * User legacy/seed có thể thiếu `smartOTP` (hoặc thiếu `devices`): khởi tạo
   * mặc định bằng cập nhật có điều kiện, idempotent và không ghi đè dữ liệu có sẵn.
   */
  private async ensureSmartOtpContainer(oid: ObjectId): Promise<void> {
    await this.userRepository.updateOne(
      { _id: oid, $or: [{ smartOTP: { $exists: false } }, { smartOTP: null }] },
      {
        $set: {
          smartOTP: {
            enabled: false,
            maxDevices: 1,
            registeredDevices: 0,
            otpAttempts: 0,
            devices: [],
          },
        },
      }
    )
    await this.userRepository.updateOne(
      { _id: oid, [DEVICES_PATH]: { $exists: false } },
      { $set: { [DEVICES_PATH]: [] } }
    )
  }

  private async findEmbedded(
    oid: ObjectId,
    deviceId: string
  ): Promise<DeviceBindingInfo | null> {
    const user = await this.userRepository.findOne({
      where: { _id: oid },
      select: ['smartOTP'],
    })
    return user?.smartOTP?.devices?.find(d => d.deviceId === deviceId) ?? null
  }

  private async userExists(oid: ObjectId): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { _id: oid },
      select: ['_id'],
    })
    return !!user
  }

  private async requireMapped(
    userId: string,
    oid: ObjectId,
    deviceId: string
  ): Promise<DeviceBinding> {
    const device = await this.findEmbedded(oid, deviceId)
    if (!device) {
      throw new NotFoundException('Không tìm thấy thiết bị liên kết')
    }
    return this.toBinding(userId, device)
  }

  private toObjectId(userId: string): ObjectId | null {
    return ObjectId.isValid(userId) ? new ObjectId(userId) : null
  }

  /**
   * Ánh xạ bản ghi nhúng về hình dạng DeviceBinding cũ. `_id` là `bindingId` đã
   * lưu; thiết bị cũ chưa có thì suy ra ổn định từ sha1(userId:deviceId).
   */
  private toBinding(userId: string, device: DeviceBindingInfo): DeviceBinding {
    const digest = createHash('sha1')
      .update(`${userId}:${device.deviceId}`)
      .digest('hex')
      .slice(0, 24)
    const binding = new DeviceBinding()
    binding._id = device.bindingId ?? new ObjectId(digest)
    binding.userId = userId
    binding.deviceId = device.deviceId
    binding.deviceName = device.deviceName
    binding.publicKey = device.publicKey
    binding.status = device.status as DeviceStatus
    binding.createdAt = device.createdAt
    binding.updatedAt = device.updatedAt
    return binding
  }
}

function matched(result: unknown): boolean {
  return ((result as { matchedCount?: number } | null)?.matchedCount ?? 0) > 0
}
