import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ProjectsService } from './projects.service'
import { Project } from './schemas/project.schema'
import { ProjectFilterDto } from './dto/project-filter.dto'

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async findAll(@Query() query: ProjectFilterDto): Promise<Project[]> {
    return this.projectsService.findAll(query)
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Project> {
    return this.projectsService.findOne(id)
  }
}
