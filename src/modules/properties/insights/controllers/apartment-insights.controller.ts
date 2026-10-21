import { Controller, Get, Param } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public } from '../../../../common/decorators/public.decorator'
import type { ApartmentInsightsResponseDto } from '../dto/apartment-insights-response.dto'
import { ApartmentInsightsService } from '../services/apartment-insights.service'

@ApiTags('apartment-insights')
@Controller('apartments')
export class ApartmentInsightsController {
  constructor(private readonly insights: ApartmentInsightsService) {}

  /** GET /api/v1/apartments/:id/insights — biến động giá & điểm tin cậy [uc_customer_apartment] */
  @Public()
  @Get(':id/insights')
  @ApiOperation({
    summary: 'Biến động giá 12 tháng và điểm tin cậy của căn hộ',
  })
  @ApiOkResponse()
  async getInsights(
    @Param('id') id: string
  ): Promise<ApartmentInsightsResponseDto> {
    return this.insights.getInsights(id)
  }
}
