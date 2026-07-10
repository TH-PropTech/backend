import {
  Controller,
  Post,
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
import { RecommendDto } from './dto/recommend.dto'
import { FeedbackDto } from './dto/feedback.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import {
  RecommendationResult,
  FeedbackResponse,
  SyncResponse,
} from './interfaces/recommendation.interface'

@ApiTags('Recommendations')
@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService
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
}
