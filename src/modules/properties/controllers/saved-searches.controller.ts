import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import {
  SavedSearchesService,
  SavedSearchListResult,
  AlertListResult,
} from '../services/saved-searches.service'
import type {
  SavedSearchView,
  SearchAlertView,
} from '../mappers/saved-search-record.mapper'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import {
  CreateSavedSearchDto,
  UpdateSavedSearchDto,
  ToggleAlertDto,
} from '../dto/saved-search.dto'
import { AlertQueryDto } from '../dto/alert-query.dto'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'

@ApiTags('saved-searches')
@Controller('saved-searches')
@UseGuards(JwtAuthGuard)
export class SavedSearchesController {
  constructor(private readonly savedSearchesService: SavedSearchesService) {}

  /**
   * POST /api/v1/saved-searches
   * Lưu bộ lọc tìm kiếm
   * [uc_saved_search_create]
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateSavedSearchDto,
    @CurrentUser('id') userId: string
  ): Promise<SavedSearchView> {
    return this.savedSearchesService.createSavedSearch(userId, dto)
  }

  /**
   * GET /api/v1/saved-searches
   * Danh sách bộ lọc đã lưu
   */
  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto
  ): Promise<SavedSearchListResult> {
    return this.savedSearchesService.getMySavedSearches(userId, query)
  }

  /**
   * PATCH /api/v1/saved-searches/:id
   * Cập nhật bộ lọc
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSavedSearchDto,
    @CurrentUser('id') userId: string
  ): Promise<SavedSearchView> {
    return this.savedSearchesService.updateSavedSearch(id, userId, dto)
  }

  /**
   * DELETE /api/v1/saved-searches/:id
   * Xóa bộ lọc (giữ alerts)
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string
  ): Promise<void> {
    return this.savedSearchesService.deleteSavedSearch(id, userId)
  }

  /**
   * PATCH /api/v1/saved-searches/:id/toggle-alert
   * Bật/tắt cảnh báo
   */
  @Patch(':id/toggle-alert')
  async toggleAlert(
    @Param('id') id: string,
    @Body() dto: ToggleAlertDto,
    @CurrentUser('id') userId: string
  ): Promise<SavedSearchView> {
    return this.savedSearchesService.toggleAlert(id, userId, dto.enabled)
  }

  /**
   * GET /api/v1/saved-searches/alerts
   * Danh sách cảnh báo
   */
  @Get('alerts')
  async getAlerts(
    @CurrentUser('id') userId: string,
    @Query() query: AlertQueryDto
  ): Promise<AlertListResult> {
    return this.savedSearchesService.getAlerts(userId, query)
  }

  /**
   * PATCH /api/v1/saved-searches/alerts/:id/read
   * Đánh dấu cảnh báo đã đọc
   */
  @Patch('alerts/:id/read')
  async markAlertRead(
    @Param('id') id: string,
    @CurrentUser('id') userId: string
  ): Promise<SearchAlertView> {
    return this.savedSearchesService.markAlertRead(id, userId)
  }

  /**
   * PATCH /api/v1/saved-searches/alerts/read-all
   * Đánh dấu tất cả cảnh báo đã đọc
   */
  @Patch('alerts/read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(
    @CurrentUser('id') userId: string
  ): Promise<{ success: boolean }> {
    await this.savedSearchesService.markAllAlertsRead(userId)
    return { success: true }
  }
}
