import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { RolesGuard } from '../../common/guards/roles.guard'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import { MoveInSettlementsService } from './move-in-settlements.service'

@ApiTags('move-in-settlements')
@ApiBearerAuth()
@Controller('move-in-settlements')
export class MoveInSettlementsController {
  constructor(private readonly service: MoveInSettlementsService) {}

  @Put(':id/handover')
  @UseGuards(JwtAuthGuard)
  handover(
    @Param('id') id: string,
    @Body()
    body: {
      handedOverAt: string
      electricity: number
      water: number
      keyCount: number
      inventoryReference?: string
      notes?: string
      overrideReason?: string
    },
    @CurrentUser() user: UserPayload
  ): ReturnType<MoveInSettlementsService['updateHandover']> {
    const isStaff =
      user.roles?.some(role => ['admin', 'staff'].includes(role)) ?? false
    return this.service.updateHandover(id, user._id || user.email || 'system', {
      ...body,
      isStaff,
    })
  }

  @Post(':id/handover/confirm')
  @UseGuards(JwtAuthGuard)
  confirm(
    @Param('id') id: string,
    @Body()
    body: {
      handoverHash: string
      discrepancyNote?: string
      role: 'tenant' | 'landlord'
    },
    @CurrentUser() user: UserPayload
  ): ReturnType<MoveInSettlementsService['confirmHandover']> {
    return this.service.confirmHandover(
      id,
      user._id || user.email || 'system',
      body.role,
      body.handoverHash,
      body.discrepancyNote
    )
  }

  @Post('admin/process-overdue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  processOverdue(): Promise<number> {
    return this.service.processOverdue()
  }
}
