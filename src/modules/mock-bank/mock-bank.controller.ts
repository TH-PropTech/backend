import {
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
  Body,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { RolesGuard } from '../../common/guards/roles.guard'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import {
  InitDepositPaymentDto,
  InitRentPaymentDto,
  PaymentCallbackDto,
} from './dto/init-payment.dto'
import {
  MockBankService,
  type MockPaymentCallbackResult,
  type MockPaymentInit,
} from './mock-bank.service'
import type { PaymentProviderName } from './providers/payment-provider.port'

@ApiTags('mock-bank')
@Controller('bank')
export class MockBankController {
  constructor(private readonly mockBankService: MockBankService) {}

  @Post('deposit/init')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  initDeposit(
    @Body() dto: InitDepositPaymentDto,
    @CurrentUser('id') userId: string
  ): Promise<MockPaymentInit> {
    return this.mockBankService.initDepositPayment(
      dto.depositAgreementId,
      userId
    )
  }

  @Post('rent/init')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  initRent(
    @Body() dto: InitRentPaymentDto,
    @CurrentUser('id') userId: string
  ): Promise<MockPaymentInit> {
    return this.mockBankService.initRentPayment(dto.paymentId, userId)
  }

  @Post('deposit-callback')
  callbackDeposit(
    @Body() body: PaymentCallbackDto,
    @Headers() headers: Record<string, string>
  ): Promise<MockPaymentCallbackResult> {
    return this.mockBankService.handleDepositCallback(
      body,
      this.callbackHeaders(headers)
    )
  }

  @Post('rent-callback')
  callbackRent(
    @Body() body: PaymentCallbackDto,
    @Headers() headers: Record<string, string>
  ): Promise<MockPaymentCallbackResult> {
    return this.mockBankService.handleRentCallback(
      body,
      this.callbackHeaders(headers)
    )
  }

  @Get('simulate-success/:txRef')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  simulate(@Param('txRef') txRef: string): Promise<MockPaymentCallbackResult> {
    return this.mockBankService.simulateSuccess(txRef)
  }

  @Get('wallet')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  wallet(@CurrentUser() user: UserPayload): Promise<{
    userId: string
    provider: PaymentProviderName
    externalAccountRef: string
    status: 'linked' | 'unlinked'
    simulation: boolean
    balance: null
  }> {
    if (!user._id) throw new UnauthorizedException('USER_ID_REQUIRED')
    return this.mockBankService.getWallet(user._id)
  }

  @Post('wallet/link')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  linkWallet(@CurrentUser() user: UserPayload): Promise<{
    userId: string
    provider: PaymentProviderName
    externalAccountRef: string
    status: 'linked' | 'unlinked'
    simulation: boolean
    balance: null
  }> {
    if (!user._id) throw new UnauthorizedException('USER_ID_REQUIRED')
    return this.mockBankService.linkWallet(user._id)
  }

  private callbackHeaders(headers: Record<string, string>): {
    timestamp: string
    nonce: string
    signature: string
  } {
    return {
      timestamp: headers['x-bank-timestamp'] ?? '',
      nonce: headers['x-bank-nonce'] ?? '',
      signature: headers['x-bank-signature'] ?? '',
    }
  }
}
