import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { BuildingsService } from './buildings.service'
import { Building } from './schemas/building.schema'

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
}
