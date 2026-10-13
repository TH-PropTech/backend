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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  RentalTransactionsService,
  RentalTransactionTimelineEvent,
  StuckRentalTransaction,
} from '../services/rental-transactions.service'
import { RecoverRentalTransactionDto } from '../dto/recover-rental-transaction.dto'

@ApiTags('rental-transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rental-transactions')
export class RentalTransactionsController {
  constructor(private readonly service: RentalTransactionsService) {}

  @Get(':applicationId/timeline')
  @Roles('tenant', 'landlord', 'staff', 'admin')
  getTimeline(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: UserPayload
  ): Promise<RentalTransactionTimelineEvent[]> {
    return this.service.getTimeline(applicationId, {
      id: user._id ?? '',
      roles: user.roles ?? [],
    })
  }

  @Get('admin/stuck')
  @Roles('staff', 'admin')
  getStuck(
    @Query('reason') reason?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ): Promise<StuckRentalTransaction[]> {
    return this.service.listStuck({
      ...(reason ? { reason } : {}),
      ...(page ? { page: Number(page) } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    })
  }

  @Post(':contractId/recover')
  @Roles('staff', 'admin')
  recover(
    @Param('contractId') contractId: string,
    @Body() dto: RecoverRentalTransactionDto,
    @CurrentUser() user: UserPayload
  ): ReturnType<RentalTransactionsService['recover']> {
    const role = user.roles?.includes('admin') ? 'admin' : 'staff'
    return this.service.recover(contractId, { id: user._id ?? '', role }, dto)
  }
}
