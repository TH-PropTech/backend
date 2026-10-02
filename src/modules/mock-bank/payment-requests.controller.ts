import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { RolesGuard } from '../../common/guards/roles.guard'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import { MockBankService, type ReceiptView } from './mock-bank.service'
import type { PaymentRequestView } from './payment-request.builder'

@ApiTags('payment-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class PaymentRequestsController {
  constructor(private readonly mockBankService: MockBankService) {}

  @Get('deposit-agreements/:id/payment-request')
  @Roles('tenant', 'staff', 'admin')
  getDepositRequest(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<PaymentRequestView | null> {
    return this.mockBankService.getDepositPaymentRequest(
      id,
      user._id ?? '',
      this.isStaff(user)
    )
  }

  @Get('payments/:id/request')
  @Roles('tenant', 'landlord', 'staff', 'admin')
  getPaymentRequest(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<PaymentRequestView | null> {
    return this.mockBankService.getPaymentRequest(
      id,
      user._id ?? '',
      this.isStaff(user)
    )
  }

  @Get('payments/:id/receipt')
  @Roles('tenant', 'landlord', 'staff', 'admin')
  getPaymentReceipt(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<ReceiptView> {
    return this.mockBankService.getPaymentReceipt(
      id,
      user._id ?? '',
      this.isStaff(user)
    )
  }

  @Get('deposit-agreements/:id/receipt')
  @Roles('tenant', 'landlord', 'staff', 'admin')
  getDepositReceipt(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<ReceiptView> {
    return this.mockBankService.getDepositReceipt(
      id,
      user._id ?? '',
      this.isStaff(user)
    )
  }

  private isStaff(user: UserPayload): boolean {
    return user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
  }
}
