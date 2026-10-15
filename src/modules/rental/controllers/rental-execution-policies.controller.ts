import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { RentalExecutionPoliciesService } from '../services/rental-execution-policies.service'
import { SaveRentalExecutionPolicyDraftDto } from '../dto/save-rental-execution-policy-draft.dto'
import { PublishRentalExecutionPolicyDto } from '../dto/publish-rental-execution-policy.dto'
import type { RentalExecutionPolicyView } from '../utils/rental-flow-config.mapper'

@ApiTags('rental-execution-policies')
@ApiBearerAuth()
@Controller('rental-execution-policies')
export class RentalExecutionPoliciesController {
  constructor(private readonly service: RentalExecutionPoliciesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async listActive(): Promise<RentalExecutionPolicyView[]> {
    return this.service.listActive()
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  async listAll(): Promise<RentalExecutionPolicyView[]> {
    return this.service.listAll()
  }

  @Post('admin/draft')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async saveDraft(
    @Body() dto: SaveRentalExecutionPolicyDraftDto,
    @CurrentUser() user: UserPayload
  ): Promise<RentalExecutionPolicyView> {
    const policyId = dto.policyId?.trim() || `execution-policy-${Date.now()}`
    return this.service.saveDraft(
      policyId,
      dto,
      user._id || user.email || 'system'
    )
  }

  @Put('admin/:policyId/draft')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateDraft(
    @Param('policyId') policyId: string,
    @Body() dto: SaveRentalExecutionPolicyDraftDto,
    @CurrentUser() user: UserPayload
  ): Promise<RentalExecutionPolicyView> {
    return this.service.saveDraft(
      policyId,
      dto,
      user._id || user.email || 'system'
    )
  }

  @Post('admin/:policyId/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async publish(
    @Param('policyId') policyId: string,
    @Body() dto: PublishRentalExecutionPolicyDto,
    @CurrentUser() user: UserPayload
  ): Promise<RentalExecutionPolicyView> {
    return this.service.publish(
      policyId,
      dto,
      user._id || user.email || 'system'
    )
  }

  @Post('admin/:policyId/:version/archive')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async archive(
    @Param('policyId') policyId: string,
    @Param('version') version: string,
    @Body('reason') reason: string,
    @CurrentUser() user: UserPayload
  ): Promise<RentalExecutionPolicyView> {
    return this.service.archive(
      policyId,
      Number(version),
      user._id || user.email || 'system',
      reason || 'Admin archived policy'
    )
  }
}
