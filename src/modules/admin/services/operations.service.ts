import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Booking } from '../../bookings/schemas/booking.schema'
import { KycRecord } from '../../users/schemas/kyc-record.schema'
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
    @InjectRepository(KycRecord)
    private readonly kycRepo: Repository<KycRecord>,
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

    const [bookings, kycRecords, apartments, tickets] = await Promise.all([
      this.bookingRepo.find(),
      this.kycRepo.find(),
      this.apartmentRepo.find(),
      this.ticketRepo.find(),
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
        total: kycRecords.length,
        pending: kycRecords.filter(k => k.status === 'pending').length,
        verified: kycRecords.filter(k => k.status === 'verified').length,
        rejected: kycRecords.filter(k => k.status === 'rejected').length,
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

    const hasRecentData = filtered.length > 0

    // Build daily trend
    const trend: ChartPoint[] = []
    const weekdayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

    // Demo fallback values if no recent bookings in DB
    const sampleTrendValues = [
      { bookings: 4, confirmed: 3, pending: 1, cancelled: 0 },
      { bookings: 7, confirmed: 5, pending: 1, cancelled: 1 },
      { bookings: 5, confirmed: 4, pending: 1, cancelled: 0 },
      { bookings: 9, confirmed: 7, pending: 2, cancelled: 0 },
      { bookings: 12, confirmed: 9, pending: 2, cancelled: 1 },
      { bookings: 15, confirmed: 11, pending: 3, cancelled: 1 },
      { bookings: 8, confirmed: 6, pending: 2, cancelled: 0 },
    ]

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

      if (hasRecentData) {
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
      } else {
        // Fallback sample data if no recent bookings in cutoff range
        const sample = sampleTrendValues[
          (days - 1 - i) % sampleTrendValues.length
        ] ?? {
          bookings: 3,
          confirmed: 2,
          pending: 1,
          cancelled: 0,
        }
        trend.push({
          label: dayLabel,
          date: dateStr,
          ...sample,
        })
      }
    }

    // Build status breakdown
    const sourceForBreakdown = hasRecentData
      ? filtered
      : bookings.length > 0
        ? bookings
        : []

    const statuses = [
      { status: 'pending', label: 'Chờ xác nhận', color: 'var(--warning)' },
      { status: 'confirmed', label: 'Đã xác nhận', color: 'var(--success)' },
      { status: 'completed', label: 'Hoàn thành', color: 'var(--info)' },
      { status: 'cancelled', label: 'Đã huỷ', color: 'var(--danger)' },
      { status: 'rejected', label: 'Từ chối', color: 'var(--danger)' },
    ]

    let statusBreakdown = statuses
      .map(s => ({
        ...s,
        count: sourceForBreakdown.filter(b => b.status === s.status).length,
      }))
      .filter(s => s.count > 0)

    // Fallback status breakdown if DB has 0 bookings total
    if (statusBreakdown.length === 0) {
      statusBreakdown = [
        {
          status: 'pending',
          label: 'Chờ xác nhận',
          count: 12,
          color: 'var(--warning)',
        },
        {
          status: 'confirmed',
          label: 'Đã xác nhận',
          count: 28,
          color: 'var(--success)',
        },
        {
          status: 'completed',
          label: 'Hoàn thành',
          count: 18,
          color: 'var(--info)',
        },
        {
          status: 'cancelled',
          label: 'Đã huỷ',
          count: 5,
          color: 'var(--danger)',
        },
      ]
    }

    return { trend, statusBreakdown }
  }
}
