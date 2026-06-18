import {
  Controller,
  Get,
  Param,
  Query,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ApartmentsService } from './apartments.service'
import {
  ApartmentResponseMapper,
  WebApartmentResponse,
  MobileApartmentResponse,
} from './mappers/apartment-response.mapper'
import { ApartmentFilterDto } from './dto/apartment-filter.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'

@ApiTags('apartments')
@Controller('apartments')
export class ApartmentsController {
  constructor(private readonly apartmentsService: ApartmentsService) {}

  @Get()
  async findAll(
    @Query() query: ApartmentFilterDto & { format?: 'web' | 'mobile' }
  ): Promise<WebApartmentResponse[] | MobileApartmentResponse[]> {
    const { format, ...filters } = query
    const apartments = await this.apartmentsService.findAll(filters)
    if (format === 'web') {
      return apartments.map(apt => ApartmentResponseMapper.toWebJson(apt))
    }
    if (format === 'mobile') {
      return apartments.map(apt => ApartmentResponseMapper.toMobileJson(apt))
    }
    // Mặc định trả về định dạng Web cho tương thích tốt nhất
    return apartments.map(apt => ApartmentResponseMapper.toWebJson(apt))
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Query('format') format?: 'web' | 'mobile'
  ): Promise<WebApartmentResponse | MobileApartmentResponse> {
    const apartment = await this.apartmentsService.findOne(id)
    if (format === 'web') {
      return ApartmentResponseMapper.toWebJson(apartment)
    }
    if (format === 'mobile') {
      return ApartmentResponseMapper.toMobileJson(apartment)
    }
    return ApartmentResponseMapper.toWebJson(apartment)
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff')
  async updateStatus(
    @Param('id') id: string,
    @Body('status')
    status: 'available' | 'pending' | 'updating' | 'unavailable',
    @Body('isVerified') isVerified?: boolean
  ): Promise<WebApartmentResponse> {
    const updated = await this.apartmentsService.updateStatus(
      id,
      status,
      isVerified
    )
    return ApartmentResponseMapper.toWebJson(updated)
  }
}
