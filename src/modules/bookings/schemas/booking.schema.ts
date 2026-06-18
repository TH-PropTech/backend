import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('bookings')
export class Booking {
  @ObjectIdColumn()
  _id!: ObjectId

  /** ID căn hộ được đặt lịch xem */
  @Column()
  apartmentId!: string

  /** Tên căn hộ (snapshot lúc tạo booking) */
  @Column()
  apartmentTitle!: string

  /** ID chủ nhà — người quyết định duyệt/từ chối lịch hẹn */
  @Column()
  landlordId!: string

  /** ID khách thuê — người gửi yêu cầu đặt lịch */
  @Column()
  tenantId!: string

  /** Tên khách thuê (snapshot) */
  @Column({ nullable: true })
  tenantName?: string | null

  /** Số điện thoại khách thuê (snapshot) */
  @Column({ nullable: true })
  tenantPhone?: string | null

  /** Thời điểm hẹn xem nhà */
  @Column()
  visitAt!: Date

  /** Hình thức xem: trực tiếp hoặc video call */
  @Column({ type: 'string' })
  method!: 'onsite' | 'video'

  /**
   * Trạng thái booking:
   * - pending: Khách gửi, chờ chủ nhà xác nhận
   * - confirmed: Chủ nhà đã đồng ý
   * - rejected: Chủ nhà từ chối
   * - cancelled: Khách hủy lịch
   * - completed: Đã xem xong
   */
  @Column({ type: 'string', default: 'pending' })
  status!: 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'completed'

  /** Lý do từ chối (nếu có) */
  @Column({ nullable: true })
  rejectedReason?: string | null

  /** Ghi chú của khách khi đặt lịch */
  @Column({ nullable: true })
  note?: string | null

  /** ID nhân viên hỗ trợ/tư vấn (nếu có — không phải người duyệt) */
  @Column({ nullable: true })
  consultantId!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
