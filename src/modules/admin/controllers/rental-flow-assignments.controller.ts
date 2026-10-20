import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { RentalFlowAssignmentsService } from '../../rental/services/rental-flow-assignments.service'
import {
  RentalFlowConfigResolver,
  type ResolvedFlowConfigResult,
} from '../../rental/services/rental-flow-config-resolver.service'
import {
  ContractImpactAnalyzer,
  type ContractImpactReport,
} from '../../rental/services/contract-impact-analyzer.service'
import { ActivateFlowAssignmentDto } from '../../rental/dto/activate-flow-assignment.dto'
import { PreviewFlowAssignmentDto } from '../../rental/dto/preview-flow-assignment.dto'
import type { RentalFlowAssignmentView } from '../../rental/utils/rental-flow-config.mapper'
import type { RentalFlowAuditView } from '../../rental/utils/rental-flow-audit.mapper'

@ApiTags('rental-flow-assignments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/rental-flow/assignments')
export class RentalFlowAssignmentsController {
  constructor(
    private readonly assignmentsService: RentalFlowAssignmentsService,
    private readonly resolver: RentalFlowConfigResolver,
    private readonly impactAnalyzer: ContractImpactAnalyzer
  ) {}

  @Get()
  @Roles('admin')
  @ApiOperation({
    summary: 'Admin/Staff xem danh sách gán cấu hình (assignments)',
  })
  async listAssignments(): Promise<RentalFlowAssignmentView[]> {
    return this.assignmentsService.listAssignments()
  }

  @Post('preview')
  @Roles('admin')
  @ApiOperation({
    summary: 'Xem trước cấu hình hiệu lực và thống kê tác động trên hợp đồng',
  })
  async preview(@Body() dto: PreviewFlowAssignmentDto): Promise<{
    resolved: ResolvedFlowConfigResult
    impact: ContractImpactReport
  }> {
    const [resolved, impact] = await Promise.all([
      this.resolver.resolve({ packageId: dto.packageId }),
      this.impactAnalyzer.analyzeImpact(),
    ])

    return { resolved, impact }
  }

  @Post()
  @Roles('admin')
  @ApiOperation({
    summary:
      'Admin kích hoạt gán cấu hình mới (tự động supersede assignment cũ)',
  })
  async activateAssignment(
    @Body() dto: ActivateFlowAssignmentDto,
    @CurrentUser() user: UserPayload
  ): Promise<RentalFlowAssignmentView> {
    const actorId = user._id || user.email || 'system'
    return this.assignmentsService.activateAssignment(dto, actorId)
  }

  @Get('audit')
  @Roles('admin')
  @ApiOperation({
    summary: 'Admin/Staff truy vấn nhật ký kiểm toán thay đổi cấu hình',
  })
  async getAudits(): Promise<RentalFlowAuditView[]> {
    return this.assignmentsService.getAudits()
  }
}
