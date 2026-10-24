import {
  BadRequestException,
  Controller,
  Body,
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
import { Payment } from '../schemas/payment.schema'
import { PaymentsService } from '../services/payments.service'
import { RequirePermission } from '../../rbac/guards/require-permission.decorator'

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @RequirePermission('read', 'Payment')
  @Roles('tenant', 'landlord', 'staff', 'admin')
  getByContract(
    @Query('contractId') contractId: string,
    @CurrentUser() user: UserPayload
  ): Promise<Payment[]> {
    if (!contractId || !user?._id) {
      throw new BadRequestException('CONTRACT_ID_REQUIRED')
    }
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.paymentsService.getByContract(contractId, user._id, isStaff)
  }

  @Get('overdue')
  @RequirePermission('read', 'Payment')
  @Roles('staff', 'admin')
  getOverdue(): Promise<Payment[]> {
    return this.paymentsService.getOverdue()
  }

  @Post('overdue/process')
  @RequirePermission('update', 'Payment')
  @Roles('staff', 'admin')
  async processOverdue(): Promise<{ overdue: number; reminders: number }> {
    return this.paymentsService.processReminders()
  }

  @Post(':id/confirm')
  @RequirePermission('update', 'Payment')
  @Roles('staff', 'admin')
  confirm(
    @Param('id') paymentId: string,
    @CurrentUser('id') actorId: string
  ): Promise<Payment> {
    return this.paymentsService.confirmPayment(paymentId, actorId, true)
  }

  @Post(':id/waive')
  @Roles('admin')
  waive(
    @Param('id') paymentId: string,
    @Body() body: { reason: string },
    @CurrentUser('id') actorId: string
  ): Promise<Payment> {
    return this.paymentsService.waivePlatformFee(
      paymentId,
      actorId,
      body.reason
    )
  }
}
