import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, FindOptionsWhere } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Booking } from './schemas/booking.schema'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'
import { NotificationsService } from '../notifications/notifications.service'
import { CreateBookingDto } from './dto/create-booking.dto'

export interface BookingStatusCounts {
  pending: number
  confirmed: number
  rejected: number
  cancelled: number
  completed: number
}

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
  statusCounts?: BookingStatusCounts
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
   * Phân tích an toàn chuỗi ngày tháng hẹn xem nhà (hỗ trợ ISO 8601, DD/MM/YYYY HH:mm, DD-MM-YYYY).
   */
  public parseVisitAt(visitAtStr: string): Date {
    if (!visitAtStr) return new Date()
    const trimmed = visitAtStr.trim()
    // Pattern 1: DD/MM/YYYY HH:mm or DD-MM-YYYY HH:mm:ss
    const dmyMatch = trimmed.match(
      /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
    )
    if (dmyMatch) {
      const day = Number(dmyMatch[1])
      const month = Number(dmyMatch[2]) - 1
      const year = Number(dmyMatch[3])
      const hour = dmyMatch[4] ? Number(dmyMatch[4]) : 9
      const minute = dmyMatch[5] ? Number(dmyMatch[5]) : 0
      const second = dmyMatch[6] ? Number(dmyMatch[6]) : 0
      return new Date(year, month, day, hour, minute, second)
    }

    // Pattern 2: Standard Date parsing (ISO 8601 or YYYY-MM-DD)
    const parsed = new Date(trimmed)
    if (!isNaN(parsed.getTime())) {
      return parsed
    }

    return new Date()
  }

  /**
   * Tenant tạo yêu cầu đặt lịch xem nhà.
   * Tự động resolve landlordId từ apartment.
   */
  async create(
    tenantId: string | null,
    dto: CreateBookingDto
  ): Promise<Booking> {
    this.logger.log(
      `Tenant ${tenantId ?? 'anonymous'} creating booking for apartment ${dto.apartmentId}`
    )

    // Lấy thông tin căn hộ để resolve landlordId
    let apartment: Apartment | null = null
    if (ObjectId.isValid(dto.apartmentId)) {
      apartment = await this.apartmentRepository.findOne({
        where: { _id: new ObjectId(dto.apartmentId) },
      })
    }
    if (!apartment) {
      const allApartments = await this.apartmentRepository.find()
      apartment =
        allApartments.find(
          a =>
            a.title.toLowerCase().includes(dto.apartmentId.toLowerCase()) ||
            dto.apartmentId.toLowerCase().includes(a.title.toLowerCase())
        ) ?? null
    }

    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ: ${dto.apartmentId}`)
    }

    if (!apartment.landlordId) {
      throw new BadRequestException(
        'Căn hộ này chưa có chủ nhà, không thể đặt lịch'
      )
    }

    // Không cho chủ nhà tự đặt lịch xem căn hộ của mình
    if (tenantId && apartment.landlordId === tenantId) {
      throw new BadRequestException(
        'Bạn không thể đặt lịch xem căn hộ của chính mình'
      )
    }

    // Lấy thông tin tenant để snapshot
    let tenantName: string | null = dto.tenantName || null
    let tenantPhone: string | null = dto.tenantPhone || null

    if (tenantId) {
      try {
        const tenant = await this.userRepository.findOne({
          where: { _id: new ObjectId(tenantId) },
        })
        if (tenant) {
          tenantName = tenant.fullName ?? tenantName
          tenantPhone = tenant.phone ?? tenantPhone
        }
      } catch {
        this.logger.warn(`Could not fetch tenant info for ${tenantId}`)
      }
    }

    const visitDate = this.parseVisitAt(dto.visitAt)

    const booking = this.bookingRepository.create({
      apartmentId: dto.apartmentId,
      apartmentTitle: apartment.title,
      landlordId: apartment.landlordId,
      tenantId: tenantId || 'anonymous',
      tenantName,
      tenantPhone,
      visitAt: visitDate,
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
      const phoneInfo = tenantPhone ? ` (SĐT: ${tenantPhone})` : ''
      await this.notificationsService.createNotification(
        apartment.landlordId,
        'Yêu cầu đặt lịch hẹn mới',
        `Khách thuê ${tenantName ?? 'Ẩn danh'}${phoneInfo} muốn đặt lịch xem căn hộ "${apartment.title}" vào lúc ${visitDate.toLocaleString('vi-VN')}.`,
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
    status: 'confirmed' | 'rejected' | 'completed',
    rejectedReason?: string
  ): Promise<Booking> {
    this.logger.log(
      `Landlord ${landlordId} updating booking ${bookingId} to ${status}`
    )

    if (status === 'rejected' && !rejectedReason) {
      throw new BadRequestException('Vui lòng nhập lý do khi từ chối lịch hẹn')
    }

    const booking = await this.findOneById(bookingId)

    // Chỉ chủ nhà của căn hộ mới được duyệt/từ chối/hoàn thành
    if (booking.landlordId !== landlordId) {
      throw new ForbiddenException(
        'Bạn không có quyền duyệt lịch hẹn cho căn hộ này'
      )
    }

    if (status === 'completed') {
      if (booking.status !== 'confirmed') {
        throw new BadRequestException(
          'Chỉ có thể hoàn thành lịch hẹn đã được xác nhận trước đó'
        )
      }
    } else {
      if (booking.status !== 'pending') {
        throw new BadRequestException(
          `Lịch hẹn đã ở trạng thái "${booking.status}", không thể thay đổi`
        )
      }
    }

    booking.status = status
    booking.rejectedReason =
      status === 'rejected' ? (rejectedReason ?? null) : null

    const saved = await this.bookingRepository.save(booking)

    // Cập nhật trạng thái thông báo của chủ nhà
    try {
      await this.notificationsService.updateBookingNotificationStatus(
        bookingId,
        status
      )
    } catch (err) {
      this.logger.warn(
        `Không thể cập nhật trạng thái thông báo cho chủ nhà:`,
        err
      )
    }

    // Gửi thông báo đến khách thuê
    try {
      const title =
        status === 'confirmed'
          ? 'Lịch hẹn xem nhà được xác nhận'
          : status === 'rejected'
            ? 'Lịch hẹn xem nhà bị từ chối'
            : 'Lịch hẹn xem nhà hoàn tất'
      const body =
        status === 'confirmed'
          ? `Chủ nhà đã đồng ý lịch hẹn xem căn hộ "${booking.apartmentTitle}" vào lúc ${new Date(booking.visitAt).toLocaleString('vi-VN')}.`
          : status === 'rejected'
            ? `Chủ nhà đã từ chối lịch hẹn xem căn hộ "${booking.apartmentTitle}". Lý do: ${rejectedReason}`
            : `Lịch hẹn xem căn hộ "${booking.apartmentTitle}" của bạn đã hoàn tất.`
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

    // Cập nhật trạng thái thông báo
    try {
      await this.notificationsService.updateBookingNotificationStatus(
        bookingId,
        'cancelled'
      )
    } catch (err) {
      this.logger.warn(
        `Không thể cập nhật trạng thái thông báo hủy lịch hẹn:`,
        err
      )
    }

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
   * Staff xem toàn bộ booking — giám sát, phân trang tại database layer.
   */
  async findAll(query: {
    status?: string | undefined
    apartmentId?: string | undefined
    page: number
    limit: number
  }): Promise<BookingListResult> {
    this.logger.log(
      `Staff fetching all bookings, status=${query.status ?? 'all'}, page=${query.page}, limit=${query.limit}`
    )

    const where: Record<string, unknown> = {}
    if (query.status) where.status = query.status
    if (query.apartmentId) where.apartmentId = query.apartmentId

    const skip = (query.page - 1) * query.limit
    const take = query.limit

    const [
      items,
      total,
      pendingCount,
      confirmedCount,
      rejectedCount,
      cancelledCount,
      completedCount,
    ] = await Promise.all([
      this.bookingRepository.find({
        where: where as FindOptionsWhere<Booking>,
        order: { createdAt: 'DESC' },
        skip,
        take,
      }),
      this.bookingRepository.count({
        where: where as FindOptionsWhere<Booking>,
      }),
      this.bookingRepository.count({
        where: { status: 'pending' } as FindOptionsWhere<Booking>,
      }),
      this.bookingRepository.count({
        where: { status: 'confirmed' } as FindOptionsWhere<Booking>,
      }),
      this.bookingRepository.count({
        where: { status: 'rejected' } as FindOptionsWhere<Booking>,
      }),
      this.bookingRepository.count({
        where: { status: 'cancelled' } as FindOptionsWhere<Booking>,
      }),
      this.bookingRepository.count({
        where: { status: 'completed' } as FindOptionsWhere<Booking>,
      }),
    ])

    // Lấy thông tin user (landlord + tenant) chỉ cho các items của trang hiện tại
    const isValidObjectId = (id: string): boolean => {
      try {
        return Boolean(id && /^[a-f\d]{24}$/i.test(id))
      } catch {
        return false
      }
    }

    const userIds = [
      ...items.map(r => r.landlordId),
      ...items.map(r => r.tenantId),
    ].filter(id => Boolean(id) && isValidObjectId(id))

    const users =
      userIds.length > 0
        ? await this.userRepository.find({
            where: {
              _id: { $in: userIds.map(id => new ObjectId(id)) },
            } as unknown as FindOptionsWhere<User>,
          })
        : []
    const userMap = new Map(users.map(u => [u._id.toString(), u]))

    const enrichedRecords = items.map(record => {
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

    const totalPages = Math.ceil(total / query.limit)
    const statusCounts: BookingStatusCounts = {
      pending: pendingCount,
      confirmed: confirmedCount,
      rejected: rejectedCount,
      cancelled: cancelledCount,
      completed: completedCount,
    }

    return {
      items: enrichedRecords,
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
      statusCounts,
    }
  }

  /**
   * Lấy chi tiết 1 booking theo ID.
   * Chống IDOR: Chỉ trả về booking nếu người gọi có role staff/admin,
   * hoặc là tenantId/landlordId của booking đó.
   * Ngược lại trả về NotFoundException (404) để không làm lộ sự tồn tại của ID.
   */
  async findOneById(
    id: string,
    currentUser?: { userId?: string | undefined; roles?: string[] | undefined }
  ): Promise<Booking> {
    try {
      const booking = await this.bookingRepository.findOne({
        where: { _id: new ObjectId(id) },
      })
      if (!booking) {
        throw new NotFoundException(`Không tìm thấy lịch hẹn: ${id}`)
      }

      if (currentUser) {
        const isStaffOrAdmin = currentUser.roles?.some(role =>
          ['staff', 'admin'].includes(role)
        )
        const isOwner = Boolean(
          currentUser.userId &&
          (booking.tenantId === currentUser.userId ||
            booking.landlordId === currentUser.userId)
        )

        if (!isStaffOrAdmin && !isOwner) {
          throw new NotFoundException(`Không tìm thấy lịch hẹn: ${id}`)
        }
      }

      return booking
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      throw new NotFoundException(`ID lịch hẹn không hợp lệ: ${id}`)
    }
  }
}
