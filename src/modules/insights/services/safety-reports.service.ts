import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, FindOptionsWhere } from 'typeorm'
import { ObjectId } from 'mongodb'
import { SafetyReport } from '../schemas/safety-report.schema'
import { CreateSafetyReportDto } from '../dto/create-safety-report.dto'
import {
  UpdateReportStatusDto,
  AppealReportDto,
} from '../dto/update-report-status.dto'
import { SafetyReportQueryDto } from '../dto/safety-report-query.dto'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { ApartmentsService } from '../../properties/services/apartments.service'

export interface SafetyReportListResult {
  items: SafetyReport[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/** Risk level auto-detection based on report category */
type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

const CATEGORY_RISK_MAP: Record<string, RiskLevel> = {
  fake_listing: 'high',
  external_payment: 'critical',
  wrong_info: 'medium',
  harassment: 'high',
  spam: 'low',
  danger: 'critical',
}

@Injectable()
export class SafetyReportsService {
  private readonly logger = new Logger(SafetyReportsService.name)

  constructor(
    @InjectRepository(SafetyReport)
    private readonly reportRepository: Repository<SafetyReport>,
    private readonly notificationsService: NotificationsService,
    private readonly apartmentsService: ApartmentsService
  ) {}

  /**
   * Tạo báo cáo an toàn mới
   * [uc_safety_report_create]
   */
  async createReport(
    reporterId: string,
    reporterRole: string,
    dto: CreateSafetyReportDto
  ): Promise<SafetyReport> {
    this.logger.log(
      `User ${reporterId} creating safety report for ${dto.targetType}:${dto.targetId}`
    )

    const riskLevel: RiskLevel = CATEGORY_RISK_MAP[dto.category] ?? 'medium'

    const report = this.reportRepository.create({
      reporterId,
      reporterRole,
      targetType: dto.targetType,
      targetId: dto.targetId,
      ...(dto.targetTitle ? { targetTitle: dto.targetTitle } : {}),
      category: dto.category,
      description: dto.description,
      evidenceUrls: dto.evidenceUrls ?? [],
      riskLevel,
      status: 'pending',
      isTargetHidden: false,
    })

    const saved = await this.reportRepository.save(report)

    // Notify staff about new report
    await this.notificationsService.createNotification(
      'staff',
      'Báo cáo an toàn mới',
      `Có báo cáo mới [${dto.category}] - Mức rủi ro: ${riskLevel}`,
      'SAFETY_REPORT',
      {
        reportId: String(saved._id),
        category: dto.category,
        riskLevel,
        targetType: dto.targetType,
      }
    )

    return saved
  }

  /**
   * Lấy danh sách báo cáo của người dùng hiện tại
   * Người báo cáo không xem được dữ liệu điều tra nhạy cảm
   */
  async getMyReports(
    userId: string,
    query: SafetyReportQueryDto
  ): Promise<SafetyReportListResult> {
    this.logger.log(`Fetching reports for user ${userId}`)

    const where: Record<string, unknown> = { reporterId: userId }
    if (query.status) where.status = query.status
    if (query.category) where.category = query.category

    const allRecords = await this.reportRepository.find({
      where: where as FindOptionsWhere<SafetyReport>,
      order: { createdAt: 'DESC' },
    })

    // Strip sensitive investigation data for reporters
    const sanitized = allRecords.map(report => {
      const copy = { ...report }
      delete (copy as Partial<SafetyReport>).resolutionNote
      delete (copy as Partial<SafetyReport>).assignedTo
      delete (copy as Partial<SafetyReport>).assignedAt
      return copy
    })

    return this.paginate(sanitized, query)
  }

  /**
   * Hàng đợi kiểm duyệt cho staff/admin
   */
  async getReportQueue(
    query: SafetyReportQueryDto
  ): Promise<SafetyReportListResult> {
    this.logger.log('Fetching moderation queue')

    const where: Record<string, unknown> = {}
    if (query.status) where.status = query.status
    if (query.category) where.category = query.category
    if (query.riskLevel) where.riskLevel = query.riskLevel

    const allRecords = await this.reportRepository.find({
      where: where as FindOptionsWhere<SafetyReport>,
      order: { createdAt: 'DESC' },
    })

    return this.paginate(allRecords, query)
  }

  /**
   * Lấy chi tiết một report (cho staff/admin)
   */
  async getReportById(reportId: string): Promise<SafetyReport> {
    const report = await this.findReportOrThrow(reportId)
    return report
  }

  /**
   * Cập nhật trạng thái báo cáo (staff/admin)
   */
  async updateStatus(
    reportId: string,
    staffId: string,
    dto: UpdateReportStatusDto
  ): Promise<SafetyReport> {
    this.logger.log(
      `Staff ${staffId} updating report ${reportId} to ${dto.status}`
    )
    const report = await this.findReportOrThrow(reportId)

    report.status = dto.status
    if (dto.resolutionCode) report.resolutionCode = dto.resolutionCode
    if (dto.resolutionNote) report.resolutionNote = dto.resolutionNote

    if (dto.status === 'investigating' && !report.assignedTo) {
      report.assignedTo = staffId
      report.assignedAt = new Date()
    }

    if (dto.status === 'resolved' || dto.status === 'dismissed') {
      report.resolvedBy = staffId
      report.resolvedAt = new Date()
    }

    const updated = await this.reportRepository.save(report)

    // Notify reporter about status change
    await this.notificationsService.createNotification(
      report.reporterId,
      'Cập nhật báo cáo an toàn',
      `Báo cáo #${reportId} đã được cập nhật trạng thái: ${dto.status}`,
      'SAFETY_REPORT_UPDATE',
      { reportId: String(report._id), status: dto.status }
    )

    return updated
  }

  /**
   * Ẩn tạm listing bị báo cáo rủi ro cao
   * Không xóa vĩnh viễn
   */
  async hideTarget(reportId: string, staffId: string): Promise<SafetyReport> {
    this.logger.log(`Staff ${staffId} hiding target for report ${reportId}`)
    const report = await this.findReportOrThrow(reportId)

    if (report.targetType !== 'listing') {
      throw new BadRequestException('Chỉ có thể ẩn tạm đối với tin đăng')
    }

    if (report.riskLevel !== 'high' && report.riskLevel !== 'critical') {
      throw new BadRequestException(
        'Chỉ báo cáo rủi ro cao hoặc nghiêm trọng mới có thể tạm ẩn tin đăng'
      )
    }

    await this.apartmentsService.updateStatus(
      report.targetId,
      'unavailable',
      false
    )

    report.isTargetHidden = true
    if (!report.assignedTo) {
      report.assignedTo = staffId
      report.assignedAt = new Date()
    }
    return this.reportRepository.save(report)
  }

  /**
   * Người báo cáo khiếu nại kết quả xử lý
   */
  async appealReport(
    reportId: string,
    userId: string,
    dto: AppealReportDto
  ): Promise<SafetyReport> {
    this.logger.log(`User ${userId} appealing report ${reportId}`)
    const report = await this.findReportOrThrow(reportId)

    if (report.reporterId !== userId) {
      throw new ForbiddenException('Chỉ người báo cáo mới có quyền khiếu nại')
    }

    if (report.status !== 'resolved' && report.status !== 'dismissed') {
      throw new BadRequestException(
        'Chỉ có thể khiếu nại báo cáo đã được xử lý hoặc bác bỏ'
      )
    }

    report.status = 'appealed'
    report.appealReason = dto.appealReason
    report.appealedAt = new Date()

    return this.reportRepository.save(report)
  }

  // ─── Private Helpers ───────────────────────────────────

  private async findReportOrThrow(reportId: string): Promise<SafetyReport> {
    let report: SafetyReport | null = null
    try {
      report = await this.reportRepository.findOne({
        where: { _id: new ObjectId(reportId) },
      })
    } catch {
      throw new NotFoundException(`ID báo cáo không hợp lệ: ${reportId}`)
    }
    if (!report) {
      throw new NotFoundException(`Không tìm thấy báo cáo: ${reportId}`)
    }
    return report
  }

  private paginate(
    records: SafetyReport[],
    query: SafetyReportQueryDto
  ): SafetyReportListResult {
    const total = records.length
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const totalPages = Math.ceil(total / limit)
    const skip = (page - 1) * limit
    const items = records.slice(skip, skip + limit)
    return { items, total, page, limit, totalPages }
  }
}
