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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import {
  CreateLegalDocDto,
  FetchLegalLinkDto,
  ListLegalDocsQueryDto,
  SearchLegalDto,
  UpdateLegalDocDto,
} from './dto/legal-knowledge.dto'
import type {
  FetchLegalLinkResult,
  LegalDocDetail,
  LegalDocItem,
} from './dto/legal-knowledge-response'
import type { LegalSearchHit } from './legal-knowledge.types'
import { LegalKnowledgeService } from './legal-knowledge.service'

@ApiTags('legal-knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('legal-knowledge')
export class LegalKnowledgeController {
  constructor(private readonly service: LegalKnowledgeService) {}

  @Get('admin')
  @ApiOperation({ summary: 'Admin: danh sách tài liệu tri thức luật' })
  async list(@Query() query: ListLegalDocsQueryDto): Promise<LegalDocItem[]> {
    return this.service.list(query)
  }

  @Get('admin/:id')
  @ApiOperation({ summary: 'Admin: chi tiết tài liệu (kèm nội dung)' })
  async detail(@Param('id') id: string): Promise<LegalDocDetail> {
    return this.service.getDetail(id)
  }

  @Post('admin/fetch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin: tải trang từ liên kết và chắt lọc nội dung bằng AI',
  })
  async fetchLink(
    @Body() dto: FetchLegalLinkDto
  ): Promise<FetchLegalLinkResult> {
    return this.service.fetchAndDistill(dto.url)
  }

  @Post('admin/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: thử tìm trong tri thức đã xuất bản' })
  async search(@Body() dto: SearchLegalDto): Promise<LegalSearchHit[]> {
    return this.service.search(dto.query, dto.limit ?? 4)
  }

  @Post('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: tạo tài liệu tri thức luật' })
  async create(
    @Body() dto: CreateLegalDocDto,
    @CurrentUser() user: UserPayload
  ): Promise<LegalDocDetail> {
    return this.service.create(dto, user._id)
  }

  @Patch('admin/:id')
  @ApiOperation({
    summary:
      'Admin: cập nhật tài liệu (đổi nội dung sẽ chia lại và lập chỉ mục)',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLegalDocDto
  ): Promise<LegalDocDetail> {
    return this.service.update(id, dto)
  }

  @Post('admin/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: xuất bản tài liệu (đưa vào chatbot)' })
  async publish(@Param('id') id: string): Promise<LegalDocDetail> {
    return this.service.publish(id)
  }

  @Post('admin/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: gỡ xuất bản (về nháp)' })
  async unpublish(@Param('id') id: string): Promise<LegalDocDetail> {
    return this.service.unpublish(id)
  }

  @Delete('admin/:id')
  @ApiOperation({ summary: 'Admin: lưu trữ tài liệu (xoá mềm)' })
  async archive(@Param('id') id: string): Promise<{ ok: true }> {
    return this.service.archive(id)
  }
}
