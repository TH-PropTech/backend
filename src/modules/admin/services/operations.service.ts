import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Booking } from '../../bookings/schemas/booking.schema'
import { KycService } from '../../users/services/kyc.service'
import { Apartment } from '../../properties/schemas/apartment.schema'
import { SupportTicket } from '../../community/schemas/support-ticket.schema'

export interface OperationsStats {
  bookings: {
    total: number
    pending: number
    confirmed: number
    cancelled: number
    completed: number
  }
  kyc: {
    total: number
    pending: number
    verified: number
    rejected: number
  }
  apartments: {
    total: number
    pending: number
    available: number
    rejected: number
  }
  tickets: {
    total: number
    open: number
    inProgress: number
    resolved: number
  }
}

export interface ChartPoint {
  label: string
  date: string
  bookings: number
  confirmed: number
  pending: number
  cancelled: number
}

export interface OperationsChartData {
  trend: ChartPoint[]
  statusBreakdown: {
    status: string
    label: string
    count: number
    color: string
  }[]
}

@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name)

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly kycService: KycService,
    @InjectRepository(Apartment)
    private readonly apartmentRepo: Repository<Apartment>,
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>
  ) {}

  /**
   * GET /api/v1/operations/stats
   * Aggregate dashboard statistics across all collections.
   */
  async getStats(): Promise<OperationsStats> {
    this.logger.log('Fetching operations stats')

    const [bookings, kycCounts, apartments, tickets] = await Promise.all([
      this.bookingRepo.find(),
      // KYC nhúng trong users.kyc (G-KYC): đếm qua KycService
      this.kycService.countByStatus(),
      this.apartmentRepo.find(),
      // Chỉ cần _id và status để đếm; không nạp messages[] (tối đa 500 tin/ticket).
      this.ticketRepo.find({ select: ['_id', 'status'] }),
    ])

    return {
      bookings: {
        total: bookings.length,
        pending: bookings.filter(b => b.status === 'pending').length,
        confirmed: bookings.filter(b => b.status === 'confirmed').length,
        cancelled: bookings.filter(
          b => b.status === 'cancelled' || b.status === 'rejected'
        ).length,
        completed: bookings.filter(b => b.status === 'completed').length,
      },
      kyc: {
        total: kycCounts.total,
        pending: kycCounts.pending,
        verified: kycCounts.verified,
        rejected: kycCounts.rejected,
      },
      apartments: {
        total: apartments.length,
        pending: apartments.filter(a => a.status === 'pending').length,
        available: apartments.filter(a => a.status === 'available').length,
        rejected: apartments.filter(a => a.status === 'rejected').length,
      },
      tickets: {
        total: tickets.length,
        open: tickets.filter(t => t.status === 'open').length,
        inProgress: tickets.filter(
          t => t.status === 'in_progress' || t.status === 'waiting_staff'
        ).length,
        resolved: tickets.filter(
          t => t.status === 'resolved' || t.status === 'closed'
        ).length,
      },
    }
  }

  /**
   * GET /api/v1/operations/chart-data?days=7
   * Returns booking trend and status breakdown for charts.
   */
  async getChartData(days: number): Promise<OperationsChartData> {
    this.logger.log(`Fetching operations chart data for last ${days} days`)

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    cutoff.setHours(0, 0, 0, 0)

    const bookings = await this.bookingRepo.find()

    // Filter bookings within date range
    const filtered = bookings.filter(b => {
      const d = new Date(b.visitAt ?? b.createdAt)
      return d >= cutoff
    })

    // Build daily trend
    const trend: ChartPoint[] = []
    const weekdayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

    for (let i = days - 1; i >= 0; i--) {
      const day = new Date()
      day.setDate(day.getDate() - i)
      day.setHours(0, 0, 0, 0)

      const next = new Date(day)
      next.setDate(next.getDate() + 1)

      const dayBookings = filtered.filter(b => {
        const d = new Date(b.visitAt ?? b.createdAt)
        return d >= day && d < next
      })

      const dayLabel =
        weekdayLabels[day.getDay()] ?? `${day.getDate()}/${day.getMonth() + 1}`
      const dateStr = day.toISOString().split('T')[0] ?? ''

      trend.push({
        label: dayLabel,
        date: dateStr,
        bookings: dayBookings.length,
        confirmed: dayBookings.filter(
          b => b.status === 'confirmed' || b.status === 'completed'
        ).length,
        pending: dayBookings.filter(b => b.status === 'pending').length,
        cancelled: dayBookings.filter(
          b => b.status === 'cancelled' || b.status === 'rejected'
        ).length,
      })
    }

    // Build status breakdown

    const statuses = [
      { status: 'pending', label: 'Chờ xác nhận', color: 'var(--warning)' },
      { status: 'confirmed', label: 'Đã xác nhận', color: 'var(--success)' },
      { status: 'completed', label: 'Hoàn thành', color: 'var(--info)' },
      { status: 'cancelled', label: 'Đã huỷ', color: 'var(--danger)' },
      { status: 'rejected', label: 'Từ chối', color: 'var(--danger)' },
    ]

    const statusBreakdown = statuses
      .map(s => ({
        ...s,
        count: filtered.filter(b => b.status === s.status).length,
      }))
      .filter(s => s.count > 0)

    return { trend, statusBreakdown }
  }
}
