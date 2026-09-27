import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { BookingsService, BookingListResult } from './bookings.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CreateBookingDto } from './dto/create-booking.dto'
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto'
import { BookingQueryDto } from './dto/booking-query.dto'
import { UserPayload } from '../auth/interfaces/auth.interface'
import { Booking } from './schemas/booking.schema'
import { Public } from '../../common/decorators/public.decorator'

@ApiTags('bookings')
@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  // ── TENANT ENDPOINTS ──

  /**
   * POST /api/v1/bookings
   * Tenant: Gửi yêu cầu đặt lịch xem nhà
   */
  @Public()
  @Post()
  async create(
    @Request() req: { user?: UserPayload },
    @Body() dto: CreateBookingDto
  ): Promise<Booking> {
    const tenantId = req.user?._id ?? null
    return this.bookingsService.create(tenantId, dto)
  }

  /**
   * GET /api/v1/bookings/my
   * Tenant: Xem các lịch hẹn mình đã đặt
   */
  @Get('my')
  async getMyBookings(
    @Request() req: { user: UserPayload },
    @Query() query: BookingQueryDto
  ): Promise<BookingListResult> {
    const tenantId = req.user._id
    if (!tenantId) throw new BadRequestException('BOOKING_USER_REQUIRED')
    return this.bookingsService.findByTenant(tenantId, {
      status: query.status,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    })
  }

  /**
   * PATCH /api/v1/bookings/:id/cancel
   * Tenant: Hủy lịch hẹn
   */
  @Patch(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Request() req: { user: UserPayload }
  ): Promise<Booking> {
    const tenantId = req.user._id
    if (!tenantId) throw new BadRequestException('BOOKING_USER_REQUIRED')
    return this.bookingsService.cancel(id, tenantId)
  }

  // ── LANDLORD ENDPOINTS ──

  /**
   * GET /api/v1/bookings/landlord
   * Landlord: Xem các yêu cầu xem nhà gửi đến căn hộ của mình
   */
  @Get('landlord')
  async getLandlordBookings(
    @Request() req: { user: UserPayload },
    @Query() query: BookingQueryDto
  ): Promise<BookingListResult> {
    const landlordId = req.user._id
    if (!landlordId) throw new BadRequestException('BOOKING_USER_REQUIRED')
    return this.bookingsService.findByLandlord(landlordId, {
      status: query.status,
      apartmentId: query.apartmentId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    })
  }

  /**
   * PATCH /api/v1/bookings/:id/status
   * Landlord: Xác nhận hoặc từ chối lịch hẹn
   */
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBookingStatusDto,
    @Request() req: { user: UserPayload }
  ): Promise<Booking> {
    const landlordId = req.user._id
    if (!landlordId) throw new BadRequestException('BOOKING_USER_REQUIRED')
    return this.bookingsService.updateStatus(
      id,
      landlordId,
      dto.status,
      dto.rejectedReason
    )
  }

  // ── STAFF ENDPOINTS (read-only monitoring) ──

  /**
   * GET /api/v1/bookings
   * Staff/Admin: Giám sát toàn bộ lịch hẹn
   */
  @Get()
  @UseGuards(RolesGuard)
  @Roles('staff', 'admin')
  async findAll(@Query() query: BookingQueryDto): Promise<BookingListResult> {
    return this.bookingsService.findAll({
      status: query.status,
      apartmentId: query.apartmentId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    })
  }

  /**
   * GET /api/v1/bookings/:id
   * Xem chi tiết 1 lịch hẹn (cho cả tenant, landlord, staff có phân quyền IDOR)
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Request() req: { user?: UserPayload }
  ): Promise<Booking> {
    return this.bookingsService.findOneById(id, {
      userId: req.user?._id,
      roles: req.user?.roles,
    })
  }
}
