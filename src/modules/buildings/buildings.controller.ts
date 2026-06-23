import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { BuildingsService } from './buildings.service'
import { Building } from './schemas/building.schema'
import { CreateBuildingDto } from './dto/create-building.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'

@ApiTags('buildings')
@Controller('buildings')
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Get()
  async findAll(@Query('projectId') projectId?: string): Promise<Building[]> {
    if (projectId) {
      return this.buildingsService.findByProject(projectId)
    }
    return this.buildingsService.findAll()
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Building> {
    return this.buildingsService.findOne(id)
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord', 'staff', 'admin')
  async findOrCreate(
    @Body() createBuildingDto: CreateBuildingDto
  ): Promise<Building> {
    return this.buildingsService.findOrCreate(createBuildingDto)
  }
}
