import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { RolesGuard } from '../../common/guards/roles.guard'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import {
  CreateRiskLayerDto,
  UpdateRiskLayerDto,
} from './dto/create-risk-layer.dto'
import { RiskScoreDto } from './dto/risk-score.dto'
import { LocationRiskService, RiskScoreResult } from './location-risk.service'
import { RiskLayerData } from './schemas/risk-layer-data.schema'

@ApiTags('location-risk')
@Controller('location-risk')
export class LocationRiskController {
  constructor(private readonly locationRiskService: LocationRiskService) {}

  /** Public district layers with source evidence. [uc_customer_apartment] [uc_search] */
  @Get('district/:district/layers')
  @ApiOperation({ summary: 'Get sourced risk layers for an exact district' })
  @ApiOkResponse({ type: RiskLayerData, isArray: true })
  async getLayers(
    @Param('district') district: string
  ): Promise<RiskLayerData[]> {
    return this.locationRiskService.getLayersForDistrict(district)
  }

  /** Advisory score; never changes listing eligibility. [uc_customer_apartment] */
  @Post('score')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calculate a weighted advisory location risk score',
  })
  @ApiOkResponse({ description: 'Score or explicit insufficient-data state' })
  async getScore(@Body() dto: RiskScoreDto): Promise<RiskScoreResult> {
    return this.locationRiskService.getRiskScore(dto.apartmentId, dto.weights)
  }

  /** Staff-managed sourced risk data. [uc_staff_apartment] */
  @Post('layers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: RiskLayerData })
  async create(@Body() dto: CreateRiskLayerDto): Promise<RiskLayerData> {
    return this.locationRiskService.create(dto)
  }

  /** Staff-managed sourced risk data. [uc_staff_apartment] */
  @Patch('layers/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiBearerAuth()
  @ApiOkResponse({ type: RiskLayerData })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRiskLayerDto
  ): Promise<RiskLayerData> {
    return this.locationRiskService.update(id, dto)
  }

  /** Staff-managed sourced risk data. [uc_staff_apartment] */
  @Delete('layers/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(@Param('id') id: string): Promise<void> {
    return this.locationRiskService.delete(id)
  }
}
