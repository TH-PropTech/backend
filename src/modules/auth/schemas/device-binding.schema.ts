import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'
import { DeviceStatus } from '../enums/device-status.enum'

/**
 * @deprecated Đã gom vào `User.smartOTP.devices[]` (xem DeviceBindingInfo trong
 * user.schema.ts và migration 007). Không còn đăng ký trong
 * TypeOrmModule.forFeature; giữ file làm kiểu trả về của DeviceBindingService
 * và để migration/rollback tham chiếu collection `device_bindings` cũ.
 */
@Entity('device_bindings')
export class DeviceBinding {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: string

  @Column()
  deviceId!: string

  @Column()
  deviceName!: string

  @Column()
  publicKey!: string // Bảng mã public key (pem format) để kiểm tra chữ ký số từ thiết bị

  @Column({
    type: 'string',
    enum: DeviceStatus,
    default: DeviceStatus.PENDING,
  })
  status!: DeviceStatus

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
