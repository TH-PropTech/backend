import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import {
  ListingReviewQueryDto,
  ReviewListingCaseDto,
} from '../../properties/dto/listing-freshness-query.dto'
import {
  ListingFreshnessService,
  type FreshnessResult,
  type ListingReviewListResult,
} from '../../properties/services/listing-freshness.service'
import type { ListingReviewCase } from '../../properties/schemas/listing-review-case.schema'
import { Public } from '../../../common/decorators/public.decorator'

@ApiTags('listing-freshness')
@Controller('listing-freshness')
export class ListingFreshnessController {
  constructor(
    private readonly listingFreshnessService: ListingFreshnessService
  ) {}

  /** GET /api/v1/listing-freshness/queue — Hàng đợi review [uc_staff_apartment] */
  @Get('queue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy hàng đợi kiểm tra listing' })
  @ApiOkResponse({ description: 'Danh sách review case phân trang' })
  async getReviewQueue(
    @Query() query: ListingReviewQueryDto
  ): Promise<ListingReviewListResult> {
    return this.listingFreshnessService.getReviewQueue(query)
  }

  /** GET /api/v1/listing-freshness/:id — Kiểm tra độ mới [uc_staff_apartment] */
  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Kiểm tra độ mới của listing' })
  @ApiOkResponse({ description: 'Kết quả freshness có giải thích' })
  async checkFreshness(@Param('id') id: string): Promise<FreshnessResult> {
    return this.listingFreshnessService.checkFreshness(id)
  }

  /** PATCH /api/v1/listing-freshness/:id/confirm — Chủ nhà xác nhận [uc_staff_apartment] */
  @Patch(':id/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xác nhận listing vẫn còn hiệu lực' })
  @ApiOkResponse({ description: 'Freshness đã được đặt lại' })
  async confirmListing(
    @Param('id') id: string,
    @CurrentUser('id') landlordId: string
  ): Promise<FreshnessResult> {
    return this.listingFreshnessService.confirmListing(id, landlordId)
  }

  /** POST /api/v1/listing-freshness/:id/detect — Tạo tín hiệu review [uc_staff_apartment] */
  @Post(':id/detect')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Phát hiện tín hiệu listing trùng' })
  @ApiCreatedResponse({ description: 'Các review case tìm thấy hoặc đã có' })
  async detectDuplicates(
    @Param('id') id: string
  ): Promise<ListingReviewCase[]> {
    return this.listingFreshnessService.detectDuplicates(id)
  }

  /** PATCH /api/v1/listing-freshness/cases/:id — Review tín hiệu [uc_staff_apartment] */
  @Patch('cases/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xác nhận hoặc bỏ qua review case' })
  @ApiOkResponse({ description: 'Review case đã được xử lý' })
  async reviewCase(
    @Param('id') id: string,
    @CurrentUser('id') reviewerId: string,
    @Body() dto: ReviewListingCaseDto
  ): Promise<ListingReviewCase> {
    return this.listingFreshnessService.reviewCase(id, reviewerId, dto.status)
  }
}
