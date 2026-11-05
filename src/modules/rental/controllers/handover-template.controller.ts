import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { HandoverTemplateService } from '../services/handover-template.service'
import {
  PublishHandoverTemplateDto,
  SaveHandoverTemplateDraftDto,
} from '../dto/handover-template.dto'
import type { HandoverTemplateView } from '../utils/handover-template.util'

@ApiTags('handover-template')
@ApiBearerAuth()
@Controller('handover-template')
export class HandoverTemplateController {
  constructor(private readonly service: HandoverTemplateService) {}

  /** Mẫu đang dùng cho form Nhận nhà (mọi người dùng đã đăng nhập). */
  @Get()
  @UseGuards(JwtAuthGuard)
  getPublished(): Promise<HandoverTemplateView | null> {
    return this.service.getPublished()
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getAdminState(): Promise<{
    published: HandoverTemplateView | null
    draft: HandoverTemplateView | null
  }> {
    return this.service.getAdminState()
  }

  @Put('admin/draft')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  saveDraft(
    @Body() dto: SaveHandoverTemplateDraftDto,
    @CurrentUser() user: UserPayload
  ): Promise<HandoverTemplateView> {
    return this.service.saveDraft(dto, user._id || user.email || 'system')
  }

  @Post('admin/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  publish(
    @Body() dto: PublishHandoverTemplateDto,
    @CurrentUser() user: UserPayload
  ): Promise<HandoverTemplateView> {
    return this.service.publish(dto, user._id || user.email || 'system')
  }
}
