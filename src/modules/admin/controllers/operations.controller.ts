import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import {
  OperationsService,
  OperationsStats,
  OperationsChartData,
} from '../services/operations.service'

@ApiTags('operations')
@Controller('operations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('staff', 'admin')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  /**
   * GET /api/v1/operations/stats
   * Tổng hợp số liệu vận hành: bookings, KYC, apartments, tickets.
   */
  @Get('stats')
  @ApiOperation({ summary: 'Lấy thống kê vận hành tổng quan cho staff/admin' })
  async getStats(): Promise<OperationsStats> {
    return this.operationsService.getStats()
  }

  /**
   * GET /api/v1/operations/chart-data?days=7
   * Dữ liệu biểu đồ: xu hướng lịch hẹn theo ngày + phân bổ trạng thái.
   */
  @Get('chart-data')
  @ApiOperation({ summary: 'Lấy dữ liệu biểu đồ vận hành' })
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    description: 'Số ngày nhìn về quá khứ (default: 7)',
  })
  async getChartData(
    @Query('days') days?: string
  ): Promise<OperationsChartData> {
    const numDays = days
      ? Math.min(Math.max(parseInt(days, 10) || 7, 1), 90)
      : 7
    return this.operationsService.getChartData(numDays)
  }
}
