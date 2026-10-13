import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { LegalSourcesService } from '../services/legal-sources.service'
import {
  CreateLegalSourceDto,
  ListLegalSourcesQueryDto,
  ReorderLegalSourcesDto,
  UpdateLegalSourceDto,
  type LegalSourceResponse,
  type PublicLegalSourceResponse,
} from '../dto/legal-source.dto'
import { Public } from '../../../common/decorators/public.decorator'

@ApiTags('legal-sources')
@Controller('legal-sources')
export class LegalSourcesController {
  constructor(private readonly service: LegalSourcesService) {}

  /** Public: nguồn pháp lý/DVC đang hiệu lực; `panel=contract` lọc nguồn hiển thị trên panel hợp đồng */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách nguồn pháp lý/DVC đang hiệu lực' })
  async findPublic(
    @Query() query: ListLegalSourcesQueryDto
  ): Promise<PublicLegalSourceResponse[]> {
    return this.service.findPublic(query.panel)
  }

  // Các route `admin` phải khai báo trước `:key` để không bị route public bắt nhầm.

  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin lấy toàn bộ nguồn pháp lý (kể cả đang tắt)' })
  async findAllAdmin(): Promise<LegalSourceResponse[]> {
    return this.service.findAllAdmin()
  }

  @Post('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin tạo nguồn pháp lý' })
  async create(
    @Body() dto: CreateLegalSourceDto,
    @CurrentUser() user: UserPayload
  ): Promise<LegalSourceResponse> {
    return this.service.create(dto, user._id ?? 'admin')
  }

  @Put('admin/reorder')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin sắp xếp lại nguồn pháp lý' })
  async reorder(
    @Body() dto: ReorderLegalSourcesDto,
    @CurrentUser() user: UserPayload
  ): Promise<LegalSourceResponse[]> {
    return this.service.reorder(dto.keys, user._id ?? 'admin')
  }

  @Patch('admin/:key')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin cập nhật nguồn pháp lý (key bất biến)' })
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateLegalSourceDto,
    @CurrentUser() user: UserPayload
  ): Promise<LegalSourceResponse> {
    return this.service.update(key, dto, user._id ?? 'admin')
  }

  @Delete('admin/:key')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Admin xoá nguồn pháp lý (409 nếu đang được quy định tham chiếu)',
  })
  async remove(@Param('key') key: string): Promise<{ deleted: true }> {
    await this.service.remove(key)
    return { deleted: true }
  }

  /** Public: chi tiết một nguồn đang hiệu lực */
  @Public()
  @Get(':key')
  @ApiOperation({ summary: 'Lấy chi tiết nguồn pháp lý/DVC' })
  async findPublicByKey(
    @Param('key') key: string
  ): Promise<PublicLegalSourceResponse> {
    return this.service.findPublicByKey(key)
  }
}
