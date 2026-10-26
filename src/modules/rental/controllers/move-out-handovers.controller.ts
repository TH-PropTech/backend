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
  ConfirmMoveOutHandoverDto,
  DisputeNoteDto,
  MoveOutDiscrepancyDto,
  RecordMoveOutHandoverDto,
} from '../dto/move-out-handover.dto'
import { MoveOutHandoversService } from '../services/move-out-handovers.service'

const actorIdOf = (user: UserPayload): string =>
  user._id || user.email || 'system'
const isStaffOf = (user: UserPayload): boolean =>
  user.roles?.some(role => ['admin', 'staff'].includes(role)) ?? false

@ApiTags('move-out-handovers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('move-out-handovers')
export class MoveOutHandoversController {
  constructor(private readonly service: MoveOutHandoversService) {}

  @Get('contract/:contractId')
  @Roles('landlord', 'tenant', 'staff', 'admin')
  get(
    @Param('contractId') contractId: string,
    @CurrentUser() user: UserPayload
  ): ReturnType<MoveOutHandoversService['findByContract']> {
    return this.service.findByContract(
      contractId,
      actorIdOf(user),
      isStaffOf(user)
    )
  }

  @Post('contract/:contractId')
  @Roles('landlord')
  record(
    @Param('contractId') contractId: string,
    @Body() body: RecordMoveOutHandoverDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<MoveOutHandoversService['record']> {
    return this.service.record(contractId, actorIdOf(user), body)
  }

  @Put('contract/:contractId')
  @Roles('landlord')
  revise(
    @Param('contractId') contractId: string,
    @Body() body: RecordMoveOutHandoverDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<MoveOutHandoversService['revise']> {
    return this.service.revise(contractId, actorIdOf(user), body)
  }

  @Post('contract/:contractId/confirm')
  @Roles('tenant')
  confirm(
    @Param('contractId') contractId: string,
    @Body() body: ConfirmMoveOutHandoverDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<MoveOutHandoversService['confirm']> {
    return this.service.confirm(contractId, actorIdOf(user), body.handoverHash)
  }

  @Post('contract/:contractId/discrepancy')
  @Roles('tenant')
  discrepancy(
    @Param('contractId') contractId: string,
    @Body() body: MoveOutDiscrepancyDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<MoveOutHandoversService['reportDiscrepancy']> {
    return this.service.reportDiscrepancy(
      contractId,
      actorIdOf(user),
      body.handoverHash,
      body.note
    )
  }

  @Post('contract/:contractId/dispute')
  @Roles('landlord', 'tenant')
  dispute(
    @Param('contractId') contractId: string,
    @Body() body: DisputeNoteDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<MoveOutHandoversService['dispute']> {
    return this.service.dispute(contractId, actorIdOf(user), body.note)
  }

  @Get('contract/:contractId/pdf')
  @Roles('landlord', 'tenant', 'staff', 'admin')
  @ApiProduces('application/pdf')
  async pdf(
    @Param('contractId') contractId: string,
    @CurrentUser() user: UserPayload,
    // Ghi byte trực tiếp để ResponseEnvelopeInterceptor không bọc Buffer thành JSON.
    @Res() response: Response
  ): Promise<void> {
    const { buffer, contractCode } = await this.service.getPdf(
      contractId,
      actorIdOf(user),
      isStaffOf(user)
    )
    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="bien-ban-tra-nha-${contractCode}.pdf"`
    )
    response.end(buffer)
  }

  @Post('admin/process-deadlines')
  @Roles('admin', 'staff')
  processDeadlines(): Promise<number> {
    return this.service.processResponseDeadlines()
  }
}
