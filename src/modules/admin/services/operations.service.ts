import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { MongoRepository } from 'typeorm'
import { ReadCacheService } from '../../health/services/read-cache.service'
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
    private readonly bookingRepo: MongoRepository<Booking>,
    private readonly kycService: KycService,
    @InjectRepository(Apartment)
    private readonly apartmentRepo: MongoRepository<Apartment>,
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: MongoRepository<SupportTicket>,
    private readonly readCache: ReadCacheService
  ) {}

  /**
   * GET /api/v1/operations/stats
   * Thống kê tổng quan; đếm theo trạng thái ngay trong MongoDB, không nạp document vào bộ nhớ.
   */
  getStats(): Promise<OperationsStats> {
    return this.readCache.wrap(
      OPERATIONS_CACHE_NAMESPACE,
      { kind: 'stats' },
      () => this.loadStats(),
      OPERATIONS_CACHE_TTL_SECONDS
    )
  }

  /**
   * GET /api/v1/operations/chart-data?days=7
   * Xu hướng đặt lịch và phân bố trạng thái cho biểu đồ.
   */
  getChartData(days: number): Promise<OperationsChartData> {
    return this.readCache.wrap(
      OPERATIONS_CACHE_NAMESPACE,
      { kind: 'chart', days },
      () => this.loadChartData(days),
      OPERATIONS_CACHE_TTL_SECONDS
    )
  }

  private async loadStats(): Promise<OperationsStats> {
    this.logger.log('Fetching operations stats')

    const [bookings, kycCounts, apartments, tickets] = await Promise.all([
      countByStatus(this.bookingRepo),
      // KYC nhúng trong users.kyc (G-KYC): đếm qua KycService
      this.kycService.countByStatus(),
      countByStatus(this.apartmentRepo),
      countByStatus(this.ticketRepo),
    ])

    return {
      bookings: {
        total: bookings.total,
        pending: bookings.of('pending'),
        confirmed: bookings.of('confirmed'),
        cancelled: bookings.of('cancelled', 'rejected'),
        completed: bookings.of('completed'),
      },
      kyc: {
        total: kycCounts.total,
        pending: kycCounts.pending,
        verified: kycCounts.verified,
        rejected: kycCounts.rejected,
      },
      apartments: {
        total: apartments.total,
        pending: apartments.of('pending'),
        available: apartments.of('available'),
        rejected: apartments.of('rejected'),
      },
      tickets: {
        total: tickets.total,
        open: tickets.of('open'),
        inProgress: tickets.of('in_progress', 'waiting_staff'),
        resolved: tickets.of('resolved', 'closed'),
      },
    }
  }

  private async loadChartData(days: number): Promise<OperationsChartData> {
    this.logger.log(`Fetching operations chart data for last ${days} days`)

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    cutoff.setHours(0, 0, 0, 0)

    const rows = await this.groupBookingsByDayAndStatus(cutoff)
    const countOf = (dayKey: string, ...statuses: string[]): number =>
      rows
        .filter(r => r.day === dayKey && statuses.includes(r.status))
        .reduce((sum, r) => sum + r.count, 0)
    const dayTotal = (dayKey: string): number =>
      rows.filter(r => r.day === dayKey).reduce((sum, r) => sum + r.count, 0)

    const trend: ChartPoint[] = []
    const weekdayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

    for (let i = days - 1; i >= 0; i--) {
      const day = new Date()
      day.setDate(day.getDate() - i)
      day.setHours(0, 0, 0, 0)

      const dayKey = localDayKey(day)
      const dayLabel =
        weekdayLabels[day.getDay()] ?? `${day.getDate()}/${day.getMonth() + 1}`
      const dateStr = day.toISOString().split('T')[0] ?? ''

      trend.push({
        label: dayLabel,
        date: dateStr,
        bookings: dayTotal(dayKey),
        confirmed: countOf(dayKey, 'confirmed', 'completed'),
        pending: countOf(dayKey, 'pending'),
        cancelled: countOf(dayKey, 'cancelled', 'rejected'),
      })
    }

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
        count: rows
          .filter(r => r.status === s.status)
          .reduce((sum, r) => sum + r.count, 0),
      }))
      .filter(s => s.count > 0)

    return { trend, statusBreakdown }
  }

  /** Gom theo (ngày theo múi giờ của tiến trình, trạng thái) ngay trong MongoDB. */
  private async groupBookingsByDayAndStatus(
    cutoff: Date
  ): Promise<DayStatusCount[]> {
    const rows = await this.bookingRepo
      .aggregate<{ _id: { day: string; status: string }; count: number }>([
        { $addFields: { at: { $ifNull: ['$visitAt', '$createdAt'] } } },
        { $match: { at: { $gte: cutoff } } },
        {
          $group: {
            _id: {
              day: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$at',
                  timezone: PROCESS_TIME_ZONE,
                },
              },
              status: '$status',
            },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray()
    return rows.map(row => ({
      day: row._id.day,
      status: row._id.status,
      count: row.count,
    }))
  }
}

const OPERATIONS_CACHE_NAMESPACE = 'operations'
const OPERATIONS_CACHE_TTL_SECONDS = 60
const PROCESS_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

interface DayStatusCount {
  day: string
  status: string
  count: number
}

interface StatusCounts {
  total: number
  of: (...statuses: string[]) => number
}

async function countByStatus(
  repository: Pick<MongoRepository<object>, 'aggregate'>
): Promise<StatusCounts> {
  const rows = await repository
    .aggregate<{
      _id: string | null
      count: number
    }>([{ $group: { _id: '$status', count: { $sum: 1 } } }])
    .toArray()
  const byStatus = new Map(rows.map(row => [row._id ?? '', row.count]))
  return {
    total: rows.reduce((sum, row) => sum + row.count, 0),
    of: (...statuses) =>
      statuses.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0),
  }
}

function localDayKey(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, '0')
  const date = String(day.getDate()).padStart(2, '0')
  return `${day.getFullYear()}-${month}-${date}`
}
