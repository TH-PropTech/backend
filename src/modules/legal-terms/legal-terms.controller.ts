import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import { LegalTermsService } from './legal-terms.service'
import { SaveDraftDto } from './dto/save-draft.dto'
import { PublishTermsDto } from './dto/publish-terms.dto'
import {
  PublicLegalTermsResponse,
  AdminLegalTermsStateResponse,
} from './dto/legal-terms-response.dto'

@ApiTags('legal-terms')
@Controller('legal-terms')
export class LegalTermsController {
  constructor(private readonly service: LegalTermsService) {}

  /**
   * Public: Lấy phiên bản điều khoản dịch vụ thuê căn hộ đang được công bố mới nhất
   */
  @Get('rental/current')
  @ApiOperation({ summary: 'Lấy phiên bản điều khoản dịch vụ đang công bố' })
  async getCurrentRentalTerms(): Promise<PublicLegalTermsResponse> {
    return this.service.getCurrentPublishedTerms()
  }

  /**
   * Public: Tra cứu phiên bản điều khoản lịch sử để kiểm chứng tính toàn vẹn
   */
  @Get('rental/versions/:version')
  @ApiOperation({ summary: 'Tra cứu phiên bản điều khoản lịch sử' })
  async getRentalTermsVersion(
    @Param('version', ParseIntPipe) version: number
  ): Promise<PublicLegalTermsResponse> {
    return this.service.getPublishedVersion(version)
  }

  /**
   * Admin: Xem trạng thái điều khoản (bản công bố hiện tại + bản nháp đang soạn)
   */
  @Get('admin/rental')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin xem trạng thái điều khoản và bản nháp' })
  async getAdminState(): Promise<AdminLegalTermsStateResponse> {
    return this.service.getAdminState()
  }

  /**
   * Admin: Lưu bản nháp điều khoản với kiểm tra optimistic concurrency
   */
  @Put('admin/rental/draft')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin lưu bản nháp điều khoản' })
  async saveDraft(
    @Body() dto: SaveDraftDto,
    @CurrentUser() user: UserPayload
  ): Promise<{ success: boolean; draftRevision: number }> {
    const actorId = user._id ?? 'admin'
    const updated = await this.service.saveDraft(dto, actorId)
    return {
      success: true,
      draftRevision: updated.draftRevision,
    }
  }

  /**
   * Admin: Xuất bản bản nháp thành phiên bản điều khoản chính thức mới
   */
  @Post('admin/rental/publish')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin xuất bản điều khoản mới' })
  async publishDraft(
    @Body() dto: PublishTermsDto,
    @CurrentUser() user: UserPayload
  ): Promise<PublicLegalTermsResponse> {
    const actorId = user._id ?? 'admin'
    return this.service.publishDraft(dto, actorId)
  }
}
