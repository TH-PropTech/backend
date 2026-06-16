import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'
import { DeviceStatus } from '../enums/device-status.enum'

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
