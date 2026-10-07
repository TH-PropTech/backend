import {
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  Post,
  UnauthorizedException,
  Body,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import {
  InitDepositPaymentDto,
  InitInvoicePaymentDto,
  InitRentPaymentDto,
  InitSettlementPaymentDto,
  PaymentCallbackDto,
} from './dto/init-payment.dto'
import {
  MockBankService,
  type MockPaymentCallbackResult,
  type MockPaymentInit,
  type GatewayPaymentResult,
} from './mock-bank.service'
import type { PaymentRequestView } from './payment-request.builder'
import type { PaymentProviderName } from './providers/payment-provider.port'
import {
  PaymentProviderRegistry,
  type PaymentProviderOption,
} from './providers/payment-provider.registry'
import {
  GatewayCallbackService,
  type VnpayIpnAck,
  type ZalopayCallbackAck,
} from './gateway-callback.service'
import {
  PayoutsService,
  type PayoutSettleResult,
} from '../payouts/payouts.service'

type GatewayQuery = Record<string, string | string[] | undefined>

@ApiTags('mock-bank')
@Controller('bank')
export class MockBankController {
  constructor(
    private readonly mockBankService: MockBankService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly gatewayCallbackService: GatewayCallbackService,
    private readonly payoutsService: PayoutsService
  ) {}

  @Get('providers')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List payment gateways the tenant may choose' })
  @ApiOkResponse({
    description: 'Enabled providers; never includes credentials',
  })
  providers(): PaymentProviderOption[] {
    return this.providerRegistry.listProviders()
  }

  @Get('attempts/:txRef/result')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get the authenticated payment result' })
  @ApiOkResponse({ description: 'Attempt and canonical payment target status' })
  paymentResult(
    @Param('txRef') txRef: string,
    @CurrentUser('id') userId: string
  ): Promise<GatewayPaymentResult> {
    return this.mockBankService.getGatewayPaymentResult(txRef, userId)
  }

  @Post('deposit/init')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  initDeposit(
    @Body() dto: InitDepositPaymentDto,
    @CurrentUser('id') userId: string,
    @Ip() clientIp: string
  ): Promise<PaymentRequestView> {
    return this.mockBankService.initDepositPayment(
      dto.depositAgreementId,
      userId,
      {
        provider: dto.provider,
        clientChannel: dto.clientChannel,
        momoMethod: dto.momoMethod,
        clientIp,
      }
    )
  }

  @Post('rent/init')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  initRent(
    @Body() dto: InitRentPaymentDto,
    @CurrentUser('id') userId: string,
    @Ip() clientIp: string
  ): Promise<MockPaymentInit> {
    return this.mockBankService.initRentPayment(dto.paymentId, userId, {
      provider: dto.provider,
      clientChannel: dto.clientChannel,
      momoMethod: dto.momoMethod,
      clientIp,
    })
  }

  @Post('settlement/init')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  initSettlement(
    @Body() dto: InitSettlementPaymentDto,
    @CurrentUser('id') userId: string,
    @Ip() clientIp: string
  ): Promise<PaymentRequestView> {
    return this.mockBankService.initSettlementPayment(
      dto.settlementId,
      userId,
      {
        provider: dto.provider,
        clientChannel: dto.clientChannel,
        momoMethod: dto.momoMethod,
        clientIp,
      }
    )
  }

  @Post('invoice/init')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  initInvoice(
    @Body() dto: InitInvoicePaymentDto,
    @CurrentUser('id') userId: string,
    @Ip() clientIp: string
  ): Promise<PaymentRequestView> {
    return this.mockBankService.initInvoicePayment(dto.paymentId, userId, {
      provider: dto.provider,
      clientChannel: dto.clientChannel,
      momoMethod: dto.momoMethod,
      clientIp,
    })
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

  @Post('settlement-callback')
  callbackSettlement(
    @Body() body: PaymentCallbackDto,
    @Headers() headers: Record<string, string>
  ): Promise<MockPaymentCallbackResult> {
    return this.mockBankService.handleSettlementCallback(
      body,
      this.callbackHeaders(headers)
    )
  }

  @Post('invoice-callback')
  callbackInvoice(
    @Body() body: PaymentCallbackDto,
    @Headers() headers: Record<string, string>
  ): Promise<MockPaymentCallbackResult> {
    return this.mockBankService.handleInvoiceCallback(
      body,
      this.callbackHeaders(headers)
    )
  }

  @Get('vnpay/return')
  @ApiOperation({ summary: 'VNPAY browser return (signed)' })
  @ApiResponse({ status: 302, description: 'Redirect to client result URL' })
  async vnpayReturn(
    @Query() query: GatewayQuery,
    @Res() response: Response
  ): Promise<void> {
    response.redirect(
      302,
      await this.gatewayCallbackService.handleReturn('vnpay', query)
    )
  }

  @Get('vnpay/ipn')
  @ApiOperation({ summary: 'VNPAY IPN (server-to-server, signed)' })
  @ApiOkResponse({ description: '{ RspCode, Message } per VNPAY spec' })
  async vnpayIpn(
    @Query() query: GatewayQuery,
    @Res() response: Response
  ): Promise<void> {
    // Raw body (no response envelope): VNPAY parses { RspCode, Message }.
    const ack: VnpayIpnAck = this.gatewayCallbackService.toVnpayAck(
      await this.gatewayCallbackService.handleNotify('vnpay', query)
    )
    response.status(200).json(ack)
  }

  @Get('momo/return')
  @ApiOperation({ summary: 'MoMo browser return (signed)' })
  @ApiResponse({ status: 302, description: 'Redirect to client result URL' })
  async momoReturn(
    @Query() query: GatewayQuery,
    @Res() response: Response
  ): Promise<void> {
    response.redirect(
      302,
      await this.gatewayCallbackService.handleReturn('momo', query)
    )
  }

  @Post('momo/ipn')
  @ApiOperation({ summary: 'MoMo IPN (server-to-server, signed)' })
  @ApiResponse({ status: 204, description: 'Notification handled' })
  @ApiResponse({ status: 400, description: 'Rejected notification' })
  async momoIpn(
    @Body() body: Record<string, unknown>,
    @Res() response: Response
  ): Promise<void> {
    const result = await this.gatewayCallbackService.handleNotify('momo', body)
    response.status(this.gatewayCallbackService.toMomoStatus(result)).end()
  }

  @Get('zalopay/return')
  @ApiOperation({ summary: 'ZaloPay browser return (checksum-signed)' })
  @ApiResponse({ status: 302, description: 'Redirect to client result URL' })
  async zalopayReturn(
    @Query() query: GatewayQuery,
    @Res() response: Response
  ): Promise<void> {
    response.redirect(
      302,
      await this.gatewayCallbackService.handleReturn('zalopay', query)
    )
  }

  @Post('zalopay/callback')
  @ApiOperation({ summary: 'ZaloPay callback (server-to-server, key2 MAC)' })
  @ApiOkResponse({
    description: '{ return_code, return_message } per ZaloPay spec',
  })
  async zalopayCallback(
    @Body() body: Record<string, unknown>,
    @Res() response: Response
  ): Promise<void> {
    // Raw body (no response envelope): ZaloPay parses { return_code, ... }.
    const ack: ZalopayCallbackAck = this.gatewayCallbackService.toZalopayAck(
      await this.gatewayCallbackService.handleNotify('zalopay', body)
    )
    response.status(200).json(ack)
  }

  @Get('simulate-success/:txRef')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  simulate(@Param('txRef') txRef: string): Promise<MockPaymentCallbackResult> {
    return this.mockBankService.simulateSuccess(txRef)
  }

  @Get('payout/:txRef/success')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Simulated payout result: transfer succeeded' })
  payoutSuccess(
    @Param('txRef') txRef: string,
    @CurrentUser() user: UserPayload
  ): Promise<PayoutSettleResult> {
    if (!user._id) throw new UnauthorizedException('USER_ID_REQUIRED')
    return this.payoutsService.settleForLandlord(txRef, 'success', user._id)
  }

  @Get('payout/:txRef/failed')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Simulated payout result: transfer failed' })
  payoutFailed(
    @Param('txRef') txRef: string,
    @CurrentUser() user: UserPayload
  ): Promise<PayoutSettleResult> {
    if (!user._id) throw new UnauthorizedException('USER_ID_REQUIRED')
    return this.payoutsService.settleForLandlord(txRef, 'failed', user._id)
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
