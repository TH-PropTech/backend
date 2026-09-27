import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import { PlatformRegulationsService } from './platform-regulations.service'
import {
  CreatePlatformRegulationDto,
  ReorderPlatformRegulationsDto,
  UpdatePlatformRegulationDto,
  type PlatformRegulationResponse,
} from './dto/platform-regulation.dto'

/** Quy định nền tảng — chỉ Admin quản trị */
@ApiTags('platform-regulations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('platform-regulations/admin')
export class PlatformRegulationsController {
  constructor(private readonly service: PlatformRegulationsService) {}

  @Get()
  @ApiOperation({ summary: 'Admin lấy danh sách quy định nền tảng' })
  async findAll(): Promise<PlatformRegulationResponse[]> {
    return this.service.findAllAdmin()
  }

  @Post()
  @ApiOperation({ summary: 'Admin tạo quy định nền tảng' })
  async create(
    @Body() dto: CreatePlatformRegulationDto,
    @CurrentUser() user: UserPayload
  ): Promise<PlatformRegulationResponse> {
    return this.service.create(dto, user._id ?? 'admin')
  }

  @Put('reorder')
  @ApiOperation({ summary: 'Admin sắp xếp lại quy định nền tảng' })
  async reorder(
    @Body() dto: ReorderPlatformRegulationsDto,
    @CurrentUser() user: UserPayload
  ): Promise<PlatformRegulationResponse[]> {
    return this.service.reorder(dto.ids, user._id ?? 'admin')
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Admin cập nhật quy định nền tảng' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePlatformRegulationDto,
    @CurrentUser() user: UserPayload
  ): Promise<PlatformRegulationResponse> {
    return this.service.update(id, dto, user._id ?? 'admin')
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Admin xoá quy định nền tảng' })
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.service.remove(id)
    return { deleted: true }
  }
}
