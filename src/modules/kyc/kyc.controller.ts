import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { KycService, KycListResult } from './kyc.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { KycQueryDto } from './dto/kyc-query.dto'
import { ReviewKycDto } from './dto/review-kyc.dto'
import { UserPayload } from '../auth/interfaces/auth.interface'
import { KycRecord } from './schemas/kyc-record.schema'

@ApiTags('kyc')
@Controller('kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  /**
   * GET /api/v1/kyc
   * Staff/Admin: Lấy danh sách hồ sơ KYC (hỗ trợ lọc, tìm kiếm, phân trang)
   */
  @Get()
  @Roles('staff', 'admin')
  async findAll(@Query() query: KycQueryDto): Promise<KycListResult> {
    return this.kycService.findAll({
      status: query.status,
      search: query.search,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    })
  }

  /**
   * GET /api/v1/kyc/stats
   * Staff/Admin: Đếm hồ sơ KYC theo trạng thái (dashboard metrics)
   */
  @Get('stats')
  @Roles('staff', 'admin')
  async getStats(): Promise<
    Record<'pending' | 'verified' | 'rejected' | 'total', number>
  > {
    return this.kycService.countByStatus()
  }

  /**
   * GET /api/v1/kyc/:id
   * Staff/Admin: Xem chi tiết 1 hồ sơ KYC
   */
  @Get(':id')
  @Roles('staff', 'admin')
  async findOne(@Param('id') id: string): Promise<KycRecord> {
    return this.kycService.findOne(id)
  }

  /**
   * PATCH /api/v1/kyc/:id/review
   * Staff/Admin: Duyệt hoặc từ chối hồ sơ KYC
   */
  @Patch(':id/review')
  @Roles('staff', 'admin')
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewKycDto,
    @Request() req: { user: UserPayload }
  ): Promise<KycRecord> {
    const reviewedBy = req.user._id
    if (!reviewedBy) throw new Error('Không thể xác thực người dùng')

    return this.kycService.review(
      id,
      dto.status,
      reviewedBy,
      dto.rejectedReason
    )
  }
}
