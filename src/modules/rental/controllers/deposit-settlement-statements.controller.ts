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
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  RecordRefundDto,
  RespondStatementDto,
  SaveStatementDraftDto,
} from '../dto/deposit-settlement-statement.dto'
import { DisputeNoteDto } from '../dto/move-out-handover.dto'
import { DepositSettlementStatementsService } from '../services/deposit-settlement-statements.service'

const actorIdOf = (user: UserPayload): string =>
  user._id || user.email || 'system'

@ApiTags('deposit-settlement-statements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('deposit-settlement-statements')
export class DepositSettlementStatementsController {
  constructor(private readonly service: DepositSettlementStatementsService) {}

  @Get('contract/:contractId')
  @Roles('landlord', 'tenant', 'staff', 'admin')
  get(
    @Param('contractId') contractId: string,
    @CurrentUser() user: UserPayload
  ): ReturnType<DepositSettlementStatementsService['findByContract']> {
    const isStaff =
      user.roles?.some(role => ['admin', 'staff'].includes(role)) ?? false
    return this.service.findByContract(contractId, actorIdOf(user), isStaff)
  }

  @Put('contract/:contractId')
  @Roles('landlord')
  saveDraft(
    @Param('contractId') contractId: string,
    @Body() body: SaveStatementDraftDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<DepositSettlementStatementsService['saveDraft']> {
    return this.service.saveDraft(contractId, actorIdOf(user), body.lines)
  }

  @Post('contract/:contractId/submit')
  @Roles('landlord')
  submit(
    @Param('contractId') contractId: string,
    @CurrentUser() user: UserPayload
  ): ReturnType<DepositSettlementStatementsService['submit']> {
    return this.service.submit(contractId, actorIdOf(user))
  }

  @Post('contract/:contractId/respond')
  @Roles('tenant')
  respond(
    @Param('contractId') contractId: string,
    @Body() body: RespondStatementDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<DepositSettlementStatementsService['respond']> {
    return this.service.respond(contractId, actorIdOf(user), body.responses)
  }

  @Post('contract/:contractId/dispute')
  @Roles('landlord', 'tenant')
  dispute(
    @Param('contractId') contractId: string,
    @Body() body: DisputeNoteDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<DepositSettlementStatementsService['dispute']> {
    return this.service.dispute(contractId, actorIdOf(user), body.note)
  }

  @Post('contract/:contractId/refunds')
  @Roles('landlord')
  recordRefund(
    @Param('contractId') contractId: string,
    @Body() body: RecordRefundDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<DepositSettlementStatementsService['recordRefund']> {
    return this.service.recordRefund(contractId, actorIdOf(user), body)
  }

  @Post('contract/:contractId/refunds/:refundId/acknowledge')
  @Roles('tenant')
  acknowledgeRefund(
    @Param('contractId') contractId: string,
    @Param('refundId') refundId: string,
    @CurrentUser() user: UserPayload
  ): ReturnType<DepositSettlementStatementsService['acknowledgeRefund']> {
    return this.service.acknowledgeRefund(contractId, actorIdOf(user), refundId)
  }

  @Post('admin/process-deadlines')
  @Roles('admin', 'staff')
  processDeadlines(): Promise<number> {
    return this.service.processDeadlines()
  }
}
