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
import { ReadCacheService } from '../../health/services/read-cache.service'
import { APARTMENT_CACHE_NAMESPACE } from '../../read-model/services/apartment-cache-invalidator.service'

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly readCache: ReadCacheService
  ) {}

  @Public()
  @Get()
  async findAll(@Query() query: ProjectFilterDto): Promise<Project[]> {
    // Dự án công khai đổi ít; dùng chung version với căn hộ vì danh sách dự án phản ánh căn hộ của dự án
    return this.readCache.wrap(
      APARTMENT_CACHE_NAMESPACE,
      { kind: 'projects', query },
      () => this.projectsService.findAll(query)
    )
  }

  @Public()
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Project> {
    return this.readCache.wrap(
      APARTMENT_CACHE_NAMESPACE,
      { kind: 'project', id },
      () => this.projectsService.findOne(id)
    )
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
