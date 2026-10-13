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
import { ProjectsService } from '../services/projects.service'
import { Project } from '../schemas/project.schema'
import { ProjectFilterDto } from '../dto/project-filter.dto'
import { CreateProjectDto } from '../dto/create-project.dto'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { Public } from '../../../common/decorators/public.decorator'

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Public()
  @Get()
  async findAll(@Query() query: ProjectFilterDto): Promise<Project[]> {
    return this.projectsService.findAll(query)
  }

  @Public()
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Project> {
    return this.projectsService.findOne(id)
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord', 'staff', 'admin')
  async findOrCreate(
    @Body() createProjectDto: CreateProjectDto
  ): Promise<Project> {
    return this.projectsService.findOrCreate(createProjectDto)
  }
}
