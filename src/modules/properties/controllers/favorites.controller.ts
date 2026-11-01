import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import {
  FavoritesService,
  SyncFavoritesResult,
} from '../services/favorites.service'
import { SyncFavoritesDto } from '../dto/sync-favorites.dto'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import {
  ApartmentResponseMapper,
  WebApartmentResponse,
  MobileApartmentResponse,
} from '../mappers/apartment-response.mapper'

function extractUserId(user: unknown): string {
  if (typeof user === 'string') return user
  if (typeof user === 'object' && user !== null) {
    const u = user as Record<string, unknown>
    return (u.id ?? u._id ?? u.sub ?? u.userId) as string
  }
  return String(user)
}

@ApiTags('favorites')
@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  /**
   * GET /api/v1/favorites
   * Lấy danh sách căn hộ yêu thích của người dùng
   */
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách căn hộ yêu thích của người dùng' })
  @ApiOkResponse({ description: 'Danh sách căn hộ yêu thích' })
  async getFavorites(
    @CurrentUser('id') rawUser: string,
    @Query() query?: PaginationQueryDto,
    @Query('format') format?: 'web' | 'mobile'
  ): Promise<WebApartmentResponse[] | MobileApartmentResponse[]> {
    const userId = extractUserId(rawUser)
    const apartments = await this.favoritesService.getFavorites(userId, query)
    if (format === 'mobile') {
      return apartments.map(apt => ApartmentResponseMapper.toMobileJson(apt))
    }
    return apartments.map(apt => ApartmentResponseMapper.toWebJson(apt))
  }

  /**
   * POST /api/v1/favorites/sync
   * Đồng bộ danh sách căn hộ yêu thích của khách vào tài khoản
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Đồng bộ danh sách yêu thích từ khách vào tài khoản',
  })
  async syncFavorites(
    @CurrentUser('id') rawUser: string,
    @Body() dto: SyncFavoritesDto
  ): Promise<SyncFavoritesResult> {
    const userId = extractUserId(rawUser)
    return this.favoritesService.syncFavorites(userId, dto.apartmentIds)
  }

  /**
   * POST /api/v1/favorites/:apartmentId
   * Thêm căn hộ vào danh sách yêu thích
   */
  @Post(':apartmentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Thêm căn hộ vào danh sách yêu thích' })
  async addFavorite(
    @CurrentUser('id') rawUser: string,
    @Param('apartmentId') apartmentId: string
  ): Promise<{ isFavorite: true }> {
    const userId = extractUserId(rawUser)
    return this.favoritesService.addFavorite(userId, apartmentId)
  }

  /**
   * DELETE /api/v1/favorites
   * Xóa tất cả căn hộ khỏi danh sách yêu thích
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa toàn bộ danh sách căn hộ yêu thích' })
  async clearFavorites(
    @CurrentUser('id') rawUser: string
  ): Promise<{ count: number }> {
    const userId = extractUserId(rawUser)
    return this.favoritesService.clearFavorites(userId)
  }

  /**
   * DELETE /api/v1/favorites/:apartmentId
   * Xóa căn hộ khỏi danh sách yêu thích
   */
  @Delete(':apartmentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa căn hộ khỏi danh sách yêu thích' })
  async removeFavorite(
    @CurrentUser('id') rawUser: string,
    @Param('apartmentId') apartmentId: string
  ): Promise<{ success: boolean }> {
    const userId = extractUserId(rawUser)
    return this.favoritesService.removeFavorite(userId, apartmentId)
  }
}
