import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import {
  SafetyReportsService,
  SafetyReportListResult,
} from '../services/safety-reports.service'
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../../common/guards/roles.guard'
import { Roles } from '../../../../common/decorators/roles.decorator'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { CreateSafetyReportDto } from '../dto/create-safety-report.dto'
import {
  UpdateReportStatusDto,
  AppealReportDto,
} from '../dto/update-report-status.dto'
import { SafetyReportQueryDto } from '../dto/safety-report-query.dto'
import { SafetyReport } from '../schemas/safety-report.schema'
import { UserPayload } from '../../../auth/interfaces/auth.interface'
import { RequirePermission } from '../../../rbac/decorators/require-permission.decorator'

@ApiTags('safety-reports')
@Controller('safety-reports')
@UseGuards(JwtAuthGuard)
export class SafetyReportsController {
  constructor(private readonly safetyReportsService: SafetyReportsService) {}

  /**
   * POST /api/v1/safety-reports
   * Tạo báo cáo an toàn mới
   * [uc_safety_report_create]
   */
  @Post()
  @RequirePermission('create', 'SafetyReport')
  @Roles('tenant', 'landlord', 'staff', 'admin')
  @UseGuards(RolesGuard)
  @HttpCode(HttpStatus.CREATED)
  async createReport(
    @Body() dto: CreateSafetyReportDto,
    @CurrentUser('id') userId: string,
    @Request() req: { user: UserPayload }
  ): Promise<SafetyReport> {
    const role = req.user.roles?.[0] ?? 'tenant'
    return this.safetyReportsService.createReport(userId, role, dto)
  }

  /**
   * GET /api/v1/safety-reports/my
   * Lấy danh sách báo cáo của người dùng hiện tại
   */
  @Get('my')
  async getMyReports(
    @CurrentUser('id') userId: string,
    @Query() query: SafetyReportQueryDto
  ): Promise<SafetyReportListResult> {
    return this.safetyReportsService.getMyReports(userId, query)
  }

  /**
   * GET /api/v1/safety-reports/queue
   * Hàng đợi kiểm duyệt cho staff/admin
   */
  @Get('queue')
  @RequirePermission('read', 'SafetyReport')
  @Roles('staff', 'admin')
  @UseGuards(RolesGuard)
  async getReportQueue(
    @Query() query: SafetyReportQueryDto
  ): Promise<SafetyReportListResult> {
    return this.safetyReportsService.getReportQueue(query)
  }

  /**
   * GET /api/v1/safety-reports/:id
   * Chi tiết báo cáo (staff/admin)
   */
  @Get(':id')
  @RequirePermission('read', 'SafetyReport')
  @Roles('staff', 'admin')
  @UseGuards(RolesGuard)
  async getReportById(@Param('id') id: string): Promise<SafetyReport> {
    return this.safetyReportsService.getReportById(id)
  }

  /**
   * PATCH /api/v1/safety-reports/:id/status
   * Cập nhật trạng thái báo cáo
   */
  @Patch(':id/status')
  @RequirePermission('update', 'SafetyReport')
  @Roles('staff', 'admin')
  @UseGuards(RolesGuard)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateReportStatusDto,
    @CurrentUser('id') staffId: string
  ): Promise<SafetyReport> {
    return this.safetyReportsService.updateStatus(id, staffId, dto)
  }

  /**
   * PATCH /api/v1/safety-reports/:id/hide-target
   * Ẩn tạm listing bị báo cáo
   */
  @Patch(':id/hide-target')
  @RequirePermission('update', 'SafetyReport')
  @Roles('staff', 'admin')
  @UseGuards(RolesGuard)
  @HttpCode(HttpStatus.OK)
  async hideTarget(
    @Param('id') id: string,
    @CurrentUser('id') staffId: string
  ): Promise<SafetyReport> {
    return this.safetyReportsService.hideTarget(id, staffId)
  }

  /**
   * POST /api/v1/safety-reports/:id/appeal
   * Khiếu nại kết quả xử lý
   */
  @Post(':id/appeal')
  @RequirePermission('update', 'SafetyReport', ['tenant', 'landlord', 'staff'])
  @HttpCode(HttpStatus.OK)
  async appealReport(
    @Param('id') id: string,
    @Body() dto: AppealReportDto,
    @CurrentUser('id') userId: string
  ): Promise<SafetyReport> {
    return this.safetyReportsService.appealReport(id, userId, dto)
  }
}
