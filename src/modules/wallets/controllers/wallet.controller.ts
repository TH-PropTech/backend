import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  LinkWalletDto,
  ReceivingStatusQueryDto,
  WalletTransactionsQueryDto,
} from '../dto/wallet.dto'
import {
  WalletsService,
  type PayableInvoice,
  type ReceivingStatus,
  type WalletTransactionPage,
  type WalletView,
} from '../services/wallets.service'
import { PayoutsService } from '../services/payouts.service'
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator'

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('landlord')
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly payoutsService: PayoutsService
  ) {}

  @Get()
  @RequirePermission('read', 'Wallet')
  @ApiOperation({ summary: 'My payout bank link (no balance held by us)' })
  getMine(@CurrentUser() user: UserPayload): Promise<WalletView> {
    return this.walletsService.getMine(this.requireUserId(user))
  }

  @Post('link')
  @RequirePermission('create', 'Wallet')
  @ApiOperation({ summary: 'Link (or change) the bank account of my wallet' })
  async link(
    @Body() dto: LinkWalletDto,
    @CurrentUser() user: UserPayload
  ): Promise<WalletView> {
    const userId = this.requireUserId(user)
    const { wallet } = await this.walletsService.link(userId, dto)
    if (!dto.brand || dto.brand === 'mocbank') {
      await this.payoutsService.releaseAwaitingWallet(userId)
    }
    return wallet
  }

  @Get('transactions')
  @RequirePermission('read', 'Wallet')
  @ApiOperation({ summary: 'Wallet statement: payouts in, platform fees out' })
  transactions(
    @Query() query: WalletTransactionsQueryDto,
    @CurrentUser() user: UserPayload
  ): Promise<WalletTransactionPage> {
    return this.walletsService.listTransactions(
      this.requireUserId(user),
      query.page,
      query.limit
    )
  }

  @Get('invoices')
  @RequirePermission('read', 'Wallet')
  @ApiOperation({
    summary: 'Platform-fee invoices I owe, payable via the payment gateway',
  })
  invoices(@CurrentUser() user: UserPayload): Promise<PayableInvoice[]> {
    return this.walletsService.listPayableInvoices(this.requireUserId(user))
  }

  @Get('receiving-status')
  @RequirePermission('read', 'Wallet')
  @ApiOperation({
    summary:
      'Receiving status: live wallet check, last payout received, stuck payouts',
  })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean })
  receivingStatus(
    @Query() query: ReceivingStatusQueryDto,
    @CurrentUser() user: UserPayload
  ): Promise<ReceivingStatus> {
    return this.walletsService.getReceivingStatus(
      this.requireUserId(user),
      query.refresh === true
    )
  }

  private requireUserId(user: UserPayload): string {
    if (!user._id) throw new UnauthorizedException('USER_ID_REQUIRED')
    return user._id
  }
}
