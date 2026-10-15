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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { RentalFlowProfilesService } from '../../rental/services/rental-flow-profiles.service'
import { SaveFlowProfileDraftDto } from '../../rental/dto/save-flow-profile-draft.dto'
import { PublishFlowProfileDto } from '../../rental/dto/publish-flow-profile.dto'
import type { RentalFlowProfileView } from '../../rental/utils/rental-flow-config.mapper'

@ApiTags('rental-flow-profiles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/rental-flow/profiles')
export class RentalFlowProfilesController {
  constructor(private readonly profilesService: RentalFlowProfilesService) {}

  @Get()
  @Roles('admin', 'staff')
  @ApiOperation({ summary: 'Admin/Staff xem danh sách Flow Profiles' })
  async listProfiles(): Promise<RentalFlowProfileView[]> {
    return this.profilesService.listProfiles()
  }

  @Get(':profileId')
  @Roles('admin', 'staff')
  @ApiOperation({
    summary: 'Admin/Staff xem chi tiết profile gồm draft và published versions',
  })
  async getProfile(@Param('profileId') profileId: string): Promise<{
    draft: RentalFlowProfileView | null
    publishedVersions: RentalFlowProfileView[]
  }> {
    return this.profilesService.getProfile(profileId)
  }

  @Get(':profileId/draft')
  @Roles('admin', 'staff')
  @ApiOperation({
    summary: 'Lấy bản nháp đang soạn hoặc khởi tạo bản nháp mới',
  })
  async getDraft(
    @Param('profileId') profileId: string
  ): Promise<RentalFlowProfileView> {
    return this.profilesService.getDraft(profileId)
  }

  @Post('draft')
  @Roles('admin')
  @ApiOperation({ summary: 'Admin tạo hoặc cập nhật bản nháp' })
  async createOrSaveDraft(
    @Body() dto: SaveFlowProfileDraftDto,
    @CurrentUser() user: UserPayload
  ): Promise<RentalFlowProfileView> {
    const actorId = user._id || user.email || 'system'
    const profileId = dto.profileId || `flow-${Date.now()}`
    return this.profilesService.saveDraft(profileId, dto, actorId)
  }

  @Put(':profileId/draft')
  @Roles('admin')
  @ApiOperation({
    summary: 'Admin lưu bản nháp với optimistic concurrency (expectedRevision)',
  })
  async saveDraft(
    @Param('profileId') profileId: string,
    @Body() dto: SaveFlowProfileDraftDto,
    @CurrentUser() user: UserPayload
  ): Promise<RentalFlowProfileView> {
    const actorId = user._id || user.email || 'system'
    return this.profilesService.saveDraft(profileId, dto, actorId)
  }

  @Post(':profileId/validate')
  @Roles('admin')
  @ApiOperation({
    summary: 'Kiểm tra tính hợp lệ của bản nháp trước khi xuất bản',
  })
  async validateDraft(@Param('profileId') profileId: string): Promise<{
    valid: boolean
    classification: string
    warnings: string[]
  }> {
    return this.profilesService.validateDraft(profileId)
  }

  @Post(':profileId/publish')
  @Roles('admin')
  @ApiOperation({
    summary:
      'Admin xuất bản phiên bản bất biến (tạo version N+1 và SHA-256 hash)',
  })
  async publish(
    @Param('profileId') profileId: string,
    @Body() dto: PublishFlowProfileDto,
    @CurrentUser() user: UserPayload
  ): Promise<RentalFlowProfileView> {
    const actorId = user._id || user.email || 'system'
    return this.profilesService.publish(profileId, dto, actorId)
  }

  @Post(':profileId/restore/:version')
  @Roles('admin')
  @ApiOperation({
    summary: 'Khôi phục nội dung phiên bản cũ thành bản nháp mới',
  })
  async restoreVersion(
    @Param('profileId') profileId: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() user: UserPayload
  ): Promise<RentalFlowProfileView> {
    const actorId = user._id || user.email || 'system'
    return this.profilesService.restoreVersionAsDraft(
      profileId,
      version,
      actorId
    )
  }
}
