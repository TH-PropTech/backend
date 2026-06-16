import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { DeviceBinding } from '../schemas/device-binding.schema'
import { DeviceStatus } from '../enums/device-status.enum'

@Injectable()
export class DeviceBindingService {
  constructor(
    @InjectRepository(DeviceBinding)
    private readonly deviceBindingRepository: Repository<DeviceBinding>
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
    // Kiểm tra xem thiết bị đã được liên kết với user này chưa
    let binding = await this.deviceBindingRepository.findOne({
      where: { userId, deviceId },
    })

    if (binding) {
      if (binding.status === DeviceStatus.BLOCKED) {
        throw new BadRequestException('Thiết bị này đã bị khóa trên hệ thống')
      }
      // Cập nhật lại thông tin mới
      binding.deviceName = deviceName
      binding.publicKey = publicKey
      binding.status = DeviceStatus.ACTIVE // kích hoạt luôn hoặc để pending
      return this.deviceBindingRepository.save(binding)
    }

    // Tạo mới binding
    binding = this.deviceBindingRepository.create({
      userId,
      deviceId,
      deviceName,
      publicKey,
      status: DeviceStatus.ACTIVE,
    })

    return this.deviceBindingRepository.save(binding)
  }

  /**
   * Lấy liên kết thiết bị cụ thể
   */
  async getDeviceBinding(
    userId: string,
    deviceId: string
  ): Promise<DeviceBinding | null> {
    return this.deviceBindingRepository.findOne({
      where: { userId, deviceId },
    })
  }

  /**
   * Lấy danh sách thiết bị liên kết của user
   */
  async getUserDevices(userId: string): Promise<DeviceBinding[]> {
    return this.deviceBindingRepository.find({
      where: { userId },
    })
  }

  /**
   * Khóa thiết bị
   */
  async blockDevice(userId: string, deviceId: string): Promise<void> {
    const binding = await this.deviceBindingRepository.findOne({
      where: { userId, deviceId },
    })

    if (!binding) {
      throw new NotFoundException('Không tìm thấy thiết bị liên kết')
    }

    binding.status = DeviceStatus.BLOCKED
    await this.deviceBindingRepository.save(binding)
  }

  /**
   * Kích hoạt thiết bị
   */
  async activateDevice(userId: string, deviceId: string): Promise<void> {
    const binding = await this.deviceBindingRepository.findOne({
      where: { userId, deviceId },
    })

    if (!binding) {
      throw new NotFoundException('Không tìm thấy thiết bị liên kết')
    }

    binding.status = DeviceStatus.ACTIVE
    await this.deviceBindingRepository.save(binding)
  }
}
