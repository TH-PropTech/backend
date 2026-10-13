import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { filterFeeQuoteForRole } from '../utils/fee-visibility.policy'
import { PlatformFeesService } from '../services/platform-fees.service'

@ApiTags('platform-fees')
@ApiBearerAuth()
@Controller('platform-fees')
export class PlatformFeesController {
  constructor(private readonly service: PlatformFeesService) {}

  @Post('admin/draft')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  saveDraft(
    @Body()
    body: {
      scheduleId: string
      version?: number
      rules: Parameters<PlatformFeesService['saveDraft']>[0]['rules']
      legalReviewStatus?: 'draft' | 'reviewed'
      reviewReference?: string
      reason: string
    },
    @CurrentUser() user: UserPayload
  ): ReturnType<PlatformFeesService['saveDraft']> {
    return this.service.saveDraft(
      body,
      user._id || user.email || 'system',
      body.version ?? 1
    )
  }

  @Post('admin/:scheduleId/:version/validate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  validate(
    @Param('scheduleId') id: string,
    @Param('version') version: string
  ): ReturnType<PlatformFeesService['validate']> {
    return this.service.validate(id, Number(version))
  }

  @Post('admin/:scheduleId/:version/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  publish(
    @Param('scheduleId') id: string,
    @Param('version') version: string,
    @Body() body: { effectiveFrom: string; reason: string },
    @CurrentUser() user: UserPayload
  ): ReturnType<PlatformFeesService['publish']> {
    return this.service.publish(
      id,
      Number(version),
      new Date(body.effectiveFrom),
      user._id || user.email || 'system',
      body.reason
    )
  }

  @Post('admin/:scheduleId/:version/archive')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  archive(
    @Param('scheduleId') id: string,
    @Param('version') version: string,
    @Body() body: { reason: string },
    @CurrentUser() user: UserPayload
  ): ReturnType<PlatformFeesService['archive']> {
    return this.service.archive(
      id,
      Number(version),
      user._id || user.email || 'system',
      body.reason
    )
  }

  @Get('quote')
  @UseGuards(JwtAuthGuard)
  async quote(
    @Query('durationMonths') duration: string,
    @Query('monthlyRent') rent: string,
    @CurrentUser() user: UserPayload
  ): Promise<Awaited<ReturnType<PlatformFeesService['quote']>> | null> {
    const result = await this.service.quote({
      durationMonths: Number(duration),
      monthlyRent: Number(rent),
    })
    if (!result) return null
    const role = user.roles?.includes('admin')
      ? 'admin'
      : user.roles?.includes('staff')
        ? 'staff'
        : user.roles?.includes('landlord')
          ? 'landlord'
          : 'tenant'
    return { ...result, quote: filterFeeQuoteForRole(result.quote, role) }
  }

  @Get('revenue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  revenue(): ReturnType<PlatformFeesService['revenue']> {
    return this.service.revenue()
  }
}
