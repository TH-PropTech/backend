import { SkipThrottle } from '@nestjs/throttler'
import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Ip,
  Logger,
  Param,
  Post,
  UnauthorizedException,
  Body,
  type RawBodyRequest,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  InitDepositPaymentDto,
  InitInvoicePaymentDto,
  InitRentPaymentDto,
  InitSettlementPaymentDto,
  PaymentCallbackDto,
} from '../dto/init-payment.dto'
import {
  MockBankService,
  type MockPaymentCallbackResult,
  type MockPaymentInit,
  type GatewayPaymentResult,
} from '../services/mock-bank.service'
import type { PaymentRequestView } from '../utils/payment-request.builder'
import {
  MocbankCallbackVerifier,
  type MocbankWebhookEnvelope,
} from '../providers/mocbank-callback.verifier'
import { GatewayVerificationError } from '../providers/payment-provider.port'
import {
  PaymentProviderRegistry,
  type PaymentProviderOption,
} from '../providers/payment-provider.registry'
import {
  GatewayCallbackService,
  type VnpayIpnAck,
  type ZalopayCallbackAck,
} from '../services/gateway-callback.service'
import {
  PayoutsService,
  type PayoutSettleResult,
} from '../../wallets/services/payouts.service'
import { Public } from '../../../common/decorators/public.decorator'

type GatewayQuery = Record<string, string | string[] | undefined>

@ApiTags('mock-bank')
@SkipThrottle()
@Controller('bank')
export class MockBankController {
  private readonly logger = new Logger(MockBankController.name)

  constructor(
    private readonly mockBankService: MockBankService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly gatewayCallbackService: GatewayCallbackService,
    private readonly payoutsService: PayoutsService,
    private readonly mocbankVerifier: MocbankCallbackVerifier
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

  @Public()
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

  @Public()
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

  @Public()
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

  @Public()
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

  @Public()
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

  @Public()
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

  @Public()
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

  @Public()
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

  @Public()
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

  @Public()
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

  @Public()
  @Get('mocbank/return')
  @ApiOperation({ summary: 'Ví Mộc browser return (signed)' })
  @ApiResponse({ status: 302, description: 'Redirect to client result URL' })
  async mocbankReturn(
    @Query() query: GatewayQuery,
    @Res() response: Response
  ): Promise<void> {
    response.redirect(
      302,
      await this.gatewayCallbackService.handleReturn('mocbank', query)
    )
  }

  @Public()
  @Post('mocbank/webhook')
  @ApiOperation({
    summary: 'Ví Mộc webhook (server-to-server, HMAC on raw body)',
  })
  @ApiResponse({ status: 200, description: 'Handled, replayed or test event' })
  @ApiResponse({ status: 400, description: 'Signed but rejected' })
  @ApiResponse({ status: 401, description: 'Invalid or stale signature' })
  @ApiResponse({ status: 503, description: 'Temporary failure, retry' })
  async mocbankWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response
  ): Promise<void> {
    const envelope = this.verifyMocbankEnvelope(request)
    if (!envelope) {
      response.status(HttpStatus.UNAUTHORIZED).end()
      return
    }
    if (envelope.event === 'webhook.test') {
      response.status(HttpStatus.OK).end()
      return
    }
    const result = await this.gatewayCallbackService.handleNotify(
      'mocbank',
      envelope.body
    )
    response.status(this.gatewayCallbackService.toMocbankStatus(result)).end()
  }

  @Get('simulate-success/:txRef')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  simulate(@Param('txRef') txRef: string): Promise<MockPaymentCallbackResult> {
    return this.mockBankService.simulateSuccess(txRef)
  }

  @Post('payout/:txRef/success')
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

  @Post('payout/:txRef/failed')
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

  /**
   * REMOVED (D4): wallets no longer hold a balance, so a platform-fee
   * invoice can no longer be paid by debiting it. Use `POST invoice/init`
   * + `POST invoice-callback` (the payment gateway flow) instead. Route
   * kept (same path) so old clients get a clear, typed error instead of a
   * 404.
   */
  @Post('wallet/pay-invoice')
  @HttpCode(HttpStatus.GONE)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  @ApiOperation({
    summary:
      'REMOVED: use POST invoice/init instead. Wallets no longer hold a balance.',
  })
  @ApiResponse({
    status: HttpStatus.GONE,
    description: '{ "message": "WALLET_BALANCE_PAYMENT_REMOVED" }',
  })
  payInvoiceFromWallet(): never {
    throw new HttpException('WALLET_BALANCE_PAYMENT_REMOVED', HttpStatus.GONE)
  }

  /** Raw-body HMAC check; null (logged by reason only) means respond 401. */
  private verifyMocbankEnvelope(
    request: RawBodyRequest<Request>
  ): MocbankWebhookEnvelope | null {
    if (!request.rawBody) {
      this.logger.warn('mocbank webhook rejected reason=missing-raw-body')
      return null
    }
    try {
      return this.mocbankVerifier.verifyWebhookEnvelope(
        request.rawBody.toString('utf8'),
        request.headers
      )
    } catch (error) {
      if (!(error instanceof GatewayVerificationError)) throw error
      this.logger.warn(`mocbank webhook rejected reason=${error.reason}`)
      return null
    }
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
