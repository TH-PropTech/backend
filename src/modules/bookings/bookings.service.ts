import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, FindOptionsWhere, FindManyOptions } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Booking } from './schemas/booking.schema'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'
import { NotificationsService } from '../notifications/notifications.service'

export interface BookingListResult {
  items: (Booking & {
    landlordName?: string
    landlordPhone?: string
    tenantEmail?: string
  })[]
  total: number
  page: number
  limit: number
  totalPages: number
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name)

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService
  ) {}

  /**
   * Tenant tạo yêu cầu đặt lịch xem nhà.
   * Tự động resolve landlordId từ apartment.
   */
  async create(
    tenantId: string,
    dto: {
      apartmentId: string
      visitAt: string
      method: 'onsite' | 'video'
      note?: string
    }
  ): Promise<Booking> {
    this.logger.log(
      `Tenant ${tenantId} creating booking for apartment ${dto.apartmentId}`
    )

    // Lấy thông tin căn hộ để resolve landlordId
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(dto.apartmentId) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ: ${dto.apartmentId}`)
    }

    if (!apartment.landlordId) {
      throw new BadRequestException(
        'Căn hộ này chưa có chủ nhà, không thể đặt lịch'
      )
    }

    // Không cho chủ nhà tự đặt lịch xem căn hộ của mình
    if (apartment.landlordId === tenantId) {
      throw new BadRequestException(
        'Bạn không thể đặt lịch xem căn hộ của chính mình'
      )
    }

    // Lấy thông tin tenant để snapshot
    let tenantName: string | null = null
    let tenantPhone: string | null = null
    try {
      const tenant = await this.userRepository.findOne({
        where: { _id: new ObjectId(tenantId) },
      })
      if (tenant) {
        tenantName = tenant.fullName ?? null
        tenantPhone = tenant.phone ?? null
      }
    } catch {
      this.logger.warn(`Could not fetch tenant info for ${tenantId}`)
    }

    const booking = this.bookingRepository.create({
      apartmentId: dto.apartmentId,
      apartmentTitle: apartment.title,
      landlordId: apartment.landlordId,
      tenantId,
      tenantName,
      tenantPhone,
      visitAt: new Date(dto.visitAt),
      method: dto.method,
      note: dto.note ?? null,
      status: 'pending',
      rejectedReason: null,
      consultantId: null,
    })

    const saved = await this.bookingRepository.save(booking)
    this.logger.log(
      `Booking created: ${String(saved._id)} for apartment ${dto.apartmentId}`
    )

    // Gửi thông báo đến chủ nhà
    try {
      await this.notificationsService.createNotification(
        apartment.landlordId,
        'Yêu cầu đặt lịch hẹn mới',
        `Khách thuê ${tenantName ?? 'Ẩn danh'} muốn đặt lịch xem căn hộ "${apartment.title}" vào lúc ${new Date(dto.visitAt).toLocaleString('vi-VN')}.`,
        'BOOKING',
        { bookingId: String(saved._id), apartmentId: dto.apartmentId }
      )
    } catch (err) {
      this.logger.warn(`Không thể gửi thông báo đặt lịch cho chủ nhà:`, err)
    }

    return saved
  }

  /**
   * Chủ nhà xác nhận hoặc từ chối lịch hẹn.
   */
  async updateStatus(
    bookingId: string,
    landlordId: string,
    status: 'confirmed' | 'rejected',
    rejectedReason?: string
  ): Promise<Booking> {
    this.logger.log(
      `Landlord ${landlordId} updating booking ${bookingId} to ${status}`
    )

    if (status === 'rejected' && !rejectedReason) {
      throw new BadRequestException('Vui lòng nhập lý do khi từ chối lịch hẹn')
    }

    const booking = await this.findOneById(bookingId)

    // Chỉ chủ nhà của căn hộ mới được duyệt/từ chối
    if (booking.landlordId !== landlordId) {
      throw new ForbiddenException(
        'Bạn không có quyền duyệt lịch hẹn cho căn hộ này'
      )
    }

    if (booking.status !== 'pending') {
      throw new BadRequestException(
        `Lịch hẹn đã ở trạng thái "${booking.status}", không thể thay đổi`
      )
    }

    booking.status = status
    booking.rejectedReason =
      status === 'rejected' ? (rejectedReason ?? null) : null

    const saved = await this.bookingRepository.save(booking)

    // Gửi thông báo đến khách thuê
    try {
      const title =
        status === 'confirmed'
          ? 'Lịch hẹn xem nhà được xác nhận'
          : 'Lịch hẹn xem nhà bị từ chối'
      const body =
        status === 'confirmed'
          ? `Chủ nhà đã đồng ý lịch hẹn xem căn hộ "${booking.apartmentTitle}" vào lúc ${new Date(booking.visitAt).toLocaleString('vi-VN')}.`
          : `Chủ nhà đã từ chối lịch hẹn xem căn hộ "${booking.apartmentTitle}". Lý do: ${rejectedReason}`
      await this.notificationsService.createNotification(
        booking.tenantId,
        title,
        body,
        'BOOKING',
        { bookingId: String(booking._id), status, rejectedReason }
      )
    } catch (err) {
      this.logger.warn(
        `Không thể gửi thông báo cập nhật lịch hẹn cho khách thuê:`,
        err
      )
    }

    return saved
  }

  /**
   * Khách hủy lịch hẹn (chỉ khi đang pending hoặc confirmed).
   */
  async cancel(bookingId: string, tenantId: string): Promise<Booking> {
    this.logger.log(`Tenant ${tenantId} cancelling booking ${bookingId}`)

    const booking = await this.findOneById(bookingId)

    if (booking.tenantId !== tenantId) {
      throw new ForbiddenException('Bạn không có quyền hủy lịch hẹn này')
    }

    if (booking.status !== 'pending' && booking.status !== 'confirmed') {
      throw new BadRequestException(
        `Không thể hủy lịch hẹn ở trạng thái "${booking.status}"`
      )
    }

    booking.status = 'cancelled'
    const saved = await this.bookingRepository.save(booking)

    // Gửi thông báo đến chủ nhà
    try {
      await this.notificationsService.createNotification(
        booking.landlordId,
        'Lịch hẹn xem nhà bị hủy',
        `Khách thuê ${booking.tenantName ?? 'Ẩn danh'} đã hủy lịch hẹn xem căn hộ "${booking.apartmentTitle}" vào lúc ${new Date(booking.visitAt).toLocaleString('vi-VN')}.`,
        'BOOKING',
        { bookingId: String(booking._id), status: 'cancelled' }
      )
    } catch (err) {
      this.logger.warn(`Không thể gửi thông báo hủy lịch hẹn cho chủ nhà:`, err)
    }

    return saved
  }

  /**
   * Lấy danh sách booking của Landlord (các yêu cầu xem nhà gửi đến chủ nhà).
   */
  async findByLandlord(
    landlordId: string,
    query: {
      status?: string | undefined
      apartmentId?: string | undefined
      page: number
      limit: number
    }
  ): Promise<BookingListResult> {
    this.logger.log(
      `Fetching bookings for landlord ${landlordId}, status=${query.status ?? 'all'}`
    )

    const where: Record<string, unknown> = { landlordId }
    if (query.status) where.status = query.status
    if (query.apartmentId) where.apartmentId = query.apartmentId

    const allRecords = await this.bookingRepository.find({
      where: where as FindOptionsWhere<Booking>,
      order: { createdAt: 'DESC' },
    })

    const total = allRecords.length
    const totalPages = Math.ceil(total / query.limit)
    const skip = (query.page - 1) * query.limit
    const items = allRecords.slice(skip, skip + query.limit)

    return { items, total, page: query.page, limit: query.limit, totalPages }
  }

  /**
   * Lấy danh sách booking của Tenant (các lịch hẹn khách đã gửi).
   */
  async findByTenant(
    tenantId: string,
    query: { status?: string | undefined; page: number; limit: number }
  ): Promise<BookingListResult> {
    this.logger.log(
      `Fetching bookings for tenant ${tenantId}, status=${query.status ?? 'all'}`
    )

    const where: Record<string, unknown> = { tenantId }
    if (query.status) where.status = query.status

    const allRecords = await this.bookingRepository.find({
      where: where as FindOptionsWhere<Booking>,
      order: { createdAt: 'DESC' },
    })

    const total = allRecords.length
    const totalPages = Math.ceil(total / query.limit)
    const skip = (query.page - 1) * query.limit
    const items = allRecords.slice(skip, skip + query.limit)

    return { items, total, page: query.page, limit: query.limit, totalPages }
  }

  /**
   * Staff xem toàn bộ booking — giám sát, không duyệt.
   */
  async findAll(query: {
    status?: string | undefined
    apartmentId?: string | undefined
    page: number
    limit: number
  }): Promise<BookingListResult> {
    this.logger.log(
      `Staff fetching all bookings, status=${query.status ?? 'all'}`
    )

    const where: Record<string, unknown> = {}
    if (query.status) where.status = query.status
    if (query.apartmentId) where.apartmentId = query.apartmentId

    const options: FindManyOptions<Booking> = {
      order: { createdAt: 'DESC' },
    }
    if (Object.keys(where).length > 0) {
      options.where = where
    }

    const allRecords = await this.bookingRepository.find(options)

    // Lấy thông tin user (landlord + tenant) tương ứng
    const userIds = [
      ...allRecords.map(r => r.landlordId),
      ...allRecords.map(r => r.tenantId),
    ].filter(Boolean)

    const users =
      userIds.length > 0
        ? await this.userRepository.find({
            where: {
              _id: { $in: userIds.map(id => new ObjectId(id)) },
            } as unknown as FindOptionsWhere<User>,
          })
        : []
    const userMap = new Map(users.map(u => [u._id.toString(), u]))

    const enrichedRecords = allRecords.map(record => {
      const landlord = userMap.get(record.landlordId)
      const tenant = userMap.get(record.tenantId)
      return {
        ...record,
        landlordName: landlord ? landlord.fullName : 'Chủ nhà TH PropTech',
        landlordPhone: landlord ? landlord.phone : 'Chưa cập nhật',
        tenantName:
          record.tenantName ||
          (tenant ? tenant.fullName : 'Khách thuê TH PropTech'),
        tenantPhone:
          record.tenantPhone || (tenant ? tenant.phone : 'Chưa cập nhật'),
        tenantEmail: tenant ? tenant.email : 'N/A',
      }
    })

    const total = enrichedRecords.length
    const totalPages = Math.ceil(total / query.limit)
    const skip = (query.page - 1) * query.limit
    const items = enrichedRecords.slice(skip, skip + query.limit)

    return { items, total, page: query.page, limit: query.limit, totalPages }
  }

  /**
   * Lấy chi tiết 1 booking theo ID.
   */
  async findOneById(id: string): Promise<Booking> {
    try {
      const booking = await this.bookingRepository.findOne({
        where: { _id: new ObjectId(id) },
      })
      if (!booking) {
        throw new NotFoundException(`Không tìm thấy lịch hẹn: ${id}`)
      }
      return booking
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      throw new NotFoundException(`ID lịch hẹn không hợp lệ: ${id}`)
    }
  }
}
