import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  ConfirmHandoverDto,
  HandoverDiscrepancyDto,
  RecordHandoverDto,
} from '../dto/move-in-handover.dto'
import { MoveInSettlementsService } from '../services/move-in-settlements.service'

const actorIdOf = (user: UserPayload): string =>
  user._id || user.email || 'system'

@ApiTags('move-in-settlements')
@ApiBearerAuth()
@Controller('move-in-settlements')
export class MoveInSettlementsController {
  constructor(private readonly service: MoveInSettlementsService) {}

  @Put(':id/handover')
  @UseGuards(JwtAuthGuard)
  handover(
    @Param('id') id: string,
    @Body() body: RecordHandoverDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<MoveInSettlementsService['updateHandover']> {
    const isStaff =
      user.roles?.some(role => ['admin', 'staff'].includes(role)) ?? false
    return this.service.updateHandover(id, actorIdOf(user), {
      ...body,
      isStaff,
    })
  }

  @Post(':id/handover/confirm')
  @UseGuards(JwtAuthGuard)
  confirm(
    @Param('id') id: string,
    @Body() body: ConfirmHandoverDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<MoveInSettlementsService['confirmHandover']> {
    return this.service.confirmHandover(
      id,
      actorIdOf(user),
      body.role,
      body.handoverHash
    )
  }

  @Get(':id/handover/pdf')
  @UseGuards(JwtAuthGuard)
  @ApiProduces('application/pdf')
  async handoverPdf(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
    // Ghi byte trực tiếp (như contracts.controller#downloadArtifact): tránh
    // ResponseEnvelopeInterceptor bọc Buffer thành JSON.
    @Res() response: Response
  ): Promise<void> {
    const isStaff =
      user.roles?.some(role => ['admin', 'staff'].includes(role)) ?? false
    const { buffer, contractCode } = await this.service.getHandoverPdf(
      id,
      actorIdOf(user),
      isStaff
    )
    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="bien-ban-ban-giao-${contractCode}.pdf"`
    )
    response.end(buffer)
  }

  @Post(':id/handover/discrepancy')
  @UseGuards(JwtAuthGuard)
  reportDiscrepancy(
    @Param('id') id: string,
    @Body() body: HandoverDiscrepancyDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<MoveInSettlementsService['reportHandoverDiscrepancy']> {
    return this.service.reportHandoverDiscrepancy(
      id,
      actorIdOf(user),
      body.handoverHash,
      body.note
    )
  }

  @Post('admin/process-overdue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  processOverdue(): Promise<number> {
    return this.service.processOverdue()
  }

  @Post('admin/process-handover-deadlines')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  processHandoverDeadlines(): Promise<number> {
    return this.service.processHandoverResponseDeadlines()
  }
}
