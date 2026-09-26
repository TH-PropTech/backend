import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger'
import { RecommendationsService } from './recommendations.service'
import { RecommendationConfigService } from './recommendation-config.service'
import { RecommendDto } from './dto/recommend.dto'
import { FeedbackDto } from './dto/feedback.dto'
import { UpdateEngineConfigDto } from './dto/update-engine-config.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import {
  RecommendationResult,
  FeedbackResponse,
  SyncResponse,
} from './interfaces/recommendation.interface'
import { RecommendationConfig } from './entities/recommendation-config.entity'

@ApiTags('Recommendations')
@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
    private readonly configService: RecommendationConfigService
  ) {}

  @Post('recommend')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lấy danh sách gợi ý căn hộ dựa trên khảo sát' })
  @ApiResponse({
    status: 200,
    description: 'Trả về top 5 căn hộ gợi ý kèm match score',
  })
  async recommend(@Body() dto: RecommendDto): Promise<RecommendationResult[]> {
    return this.recommendationsService.recommend(dto)
  }

  @Post('feedback')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gửi phản hồi yêu thích/không thích căn hộ' })
  @ApiResponse({
    status: 200,
    description: 'Ghi nhận phản hồi thành công và cập nhật mô hình',
  })
  async feedback(@Body() dto: FeedbackDto): Promise<FeedbackResponse> {
    return this.recommendationsService.feedback(dto)
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Đồng bộ danh sách căn hộ thực tế và huấn luyện lại mô hình',
  })
  @ApiResponse({ status: 200, description: 'Đồng bộ thành công' })
  async sync(): Promise<SyncResponse> {
    return this.recommendationsService.sync()
  }

  @Get('engine-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy cấu hình chiến lược AI engine hiện tại (Staff+)',
  })
  @ApiResponse({
    status: 200,
    description: 'Trả về config chiến lược gợi ý toàn hệ thống',
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getEngineConfig(): Promise<RecommendationConfig> {
    return this.configService.getConfig()
  }

  @Put('engine-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cập nhật cấu hình AI engine và retrain model ngay lập tức (Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Config đã được lưu và model đã retrain',
  })
  @ApiResponse({
    status: 400,
    description: 'strategy must be one of: hybrid, map, weighted, map-weighted',
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async updateEngineConfig(
    @Body() dto: UpdateEngineConfigDto,
    @CurrentUser('email') adminEmail: string
  ): Promise<RecommendationConfig> {
    const saved = await this.configService.updateConfig(
      dto,
      adminEmail ?? 'admin'
    )
    // Retrain immediately so all subsequent recommendations use the new strategy
    // TODO(production): Move to background job if dataset exceeds 100k records
    await this.recommendationsService.retrainModel()
    return saved
  }
}
