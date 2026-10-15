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
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger'
import { Roles } from '../../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard'
import { AreaProfileQueryDto } from '../dto/area-profile-query.dto'
import {
  CreateAreaProfileDto,
  UpdateAreaProfileDto,
} from '../dto/create-area-profile.dto'
import {
  AreaProfilesService,
  type ProfileListResult,
} from '../services/area-profiles.service'
import type { AreaProfileView } from '../utils/district-data.mapper'
import { Public } from '../../../../common/decorators/public.decorator'

@ApiTags('area-profiles')
@Controller('area-profiles')
export class AreaProfilesController {
  constructor(private readonly areaProfilesService: AreaProfilesService) {}
  /** GET /api/v1/area-profiles — Public area profiles [uc_customer_apartment] */
  @Public()
  @Get()
  @ApiOkResponse()
  async findAll(
    @Query() query: AreaProfileQueryDto
  ): Promise<ProfileListResult> {
    return this.areaProfilesService.getAllProfiles(query)
  }
  /** GET /api/v1/area-profiles/apartment/:id — Public profile for listing [uc_customer_apartment] */
  @Public()
  @Get('apartment/:id')
  @ApiOkResponse()
  async forApartment(@Param('id') id: string): Promise<AreaProfileView | null> {
    return this.areaProfilesService.getForApartment(id)
  }
  /** GET /api/v1/area-profiles/:id — Public profile [uc_customer_apartment] */
  @Public()
  @Get(':id')
  @ApiOkResponse()
  async findOne(@Param('id') id: string): Promise<AreaProfileView> {
    return this.areaProfilesService.getById(id)
  }
  /** POST /api/v1/area-profiles — Create profile [uc_staff_apartment] */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiBearerAuth()
  @ApiCreatedResponse()
  async create(@Body() dto: CreateAreaProfileDto): Promise<AreaProfileView> {
    return this.areaProfilesService.createProfile(dto)
  }
  /** PATCH /api/v1/area-profiles/:id — Update profile [uc_staff_apartment] */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiBearerAuth()
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAreaProfileDto
  ): Promise<AreaProfileView> {
    return this.areaProfilesService.updateProfile(id, dto)
  }
  /** DELETE /api/v1/area-profiles/:id — Delete profile [uc_staff_apartment] */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(@Param('id') id: string): Promise<void> {
    return this.areaProfilesService.deleteProfile(id)
  }
}
