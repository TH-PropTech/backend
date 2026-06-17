import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ApartmentsService } from './apartments.service'
import {
  ApartmentResponseMapper,
  WebApartmentResponse,
  MobileApartmentResponse,
} from './mappers/apartment-response.mapper'

@ApiTags('apartments')
@Controller('apartments')
export class ApartmentsController {
  constructor(private readonly apartmentsService: ApartmentsService) {}

  @Get()
  async findAll(
    @Query('format') format?: 'web' | 'mobile'
  ): Promise<WebApartmentResponse[] | MobileApartmentResponse[]> {
    const apartments = await this.apartmentsService.findAll()
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
}
