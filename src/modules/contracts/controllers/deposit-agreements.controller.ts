import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  ConfirmDepositPaymentDto,
  ConsentDepositAgreementDto,
} from '../dto/deposit-agreement.dto'
import { DepositAgreementsService } from '../services/deposit-agreements.service'
import { DepositAgreement } from '../schemas/deposit-agreement.schema'

@ApiTags('deposit-agreements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('deposit-agreements')
export class DepositAgreementsController {
  constructor(private readonly service: DepositAgreementsService) {}

  @Get(':id')
  @Roles('tenant', 'landlord', 'staff', 'admin')
  get(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<DepositAgreement> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.service.getAgreement(id, user._id ?? '', isStaff)
  }

  @Post(':id/consent')
  @Roles('tenant')
  consent(
    @Param('id') id: string,
    @Body() dto: ConsentDepositAgreementDto,
    @CurrentUser('id') tenantId: string
  ): Promise<DepositAgreement> {
    return this.service.consent(
      id,
      tenantId,
      dto.expectedRevision,
      dto.expectedContentHash
    )
  }

  @Post(':id/confirm-payment')
  @Roles('staff', 'admin')
  confirmPayment(
    @Param('id') id: string,
    @Body() dto: ConfirmDepositPaymentDto,
    @CurrentUser('id') staffId: string
  ): Promise<DepositAgreement> {
    return this.service.confirmDepositReceived(id, staffId, dto.note)
  }

  @Post(':id/cancel')
  @Roles('tenant', 'landlord', 'staff', 'admin')
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<DepositAgreement> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.service.cancel(id, user._id ?? '', isStaff)
  }

  @Post(':id/expire')
  @Roles('staff', 'admin')
  expire(@Param('id') id: string): Promise<DepositAgreement> {
    return this.service.expire(id)
  }
}
