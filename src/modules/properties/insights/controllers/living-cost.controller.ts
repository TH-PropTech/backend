import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import {
  LivingCostService,
  CalculationResult,
  ProfileListResult,
} from '../services/living-cost.service'
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import {
  CalculateLivingCostDto,
  CreateLivingCostProfileDto,
} from '../dto/living-cost.dto'
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto'
import type { LivingCostProfileView } from '../schemas/apartment-analysis.mapper'
import { Public } from '../../../../common/decorators/public.decorator'

@ApiTags('living-cost')
@Controller('living-cost')
export class LivingCostController {
  constructor(private readonly livingCostService: LivingCostService) {}

  /**
   * POST /api/v1/living-cost/calculate
   * Tính toán chi phí sinh hoạt hàng tháng (Không bắt buộc Auth)
   * [uc_living_cost_calculate]
   */
  @Public()
  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  calculate(@Body() dto: CalculateLivingCostDto): CalculationResult {
    return this.livingCostService.calculateCost(dto)
  }

  /**
   * POST /api/v1/living-cost/profiles
   * Lưu hồ sơ chi phí tính toán (Cần Auth)
   */
  @Post('profiles')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async saveProfile(
    @Body() dto: CreateLivingCostProfileDto,
    @CurrentUser('id') userId: string
  ): Promise<LivingCostProfileView> {
    return this.livingCostService.saveProfile(userId, dto)
  }

  /**
   * GET /api/v1/living-cost/profiles
   * Danh sách hồ sơ chi phí của người dùng
   */
  @Get('profiles')
  @UseGuards(JwtAuthGuard)
  async getMyProfiles(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto
  ): Promise<ProfileListResult> {
    return this.livingCostService.getMyProfiles(userId, query)
  }

  /**
   * DELETE /api/v1/living-cost/profiles/:id
   * Xóa hồ sơ chi phí
   */
  @Delete('profiles/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProfile(
    @Param('id') id: string,
    @CurrentUser('id') userId: string
  ): Promise<void> {
    return this.livingCostService.deleteProfile(id, userId)
  }
}
