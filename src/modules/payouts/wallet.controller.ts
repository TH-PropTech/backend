import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { RolesGuard } from '../../common/guards/roles.guard'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import {
  LinkWalletDto,
  WalletTransactionsQueryDto,
} from '../wallets/dto/wallet.dto'
import {
  WalletsService,
  type PayableInvoice,
  type WalletTransactionPage,
  type WalletView,
} from '../wallets/wallets.service'
import { PayoutsService } from './payouts.service'

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
  @ApiOperation({ summary: 'My payout wallet: bank link, balance, totals' })
  getMine(@CurrentUser() user: UserPayload): Promise<WalletView> {
    return this.walletsService.getMine(this.requireUserId(user))
  }

  @Get('banks')
  @ApiOperation({ summary: 'Banks a wallet can be linked to' })
  banks(): ReadonlyArray<{ code: string; name: string }> {
    return this.walletsService.listBanks()
  }

  @Post('link')
  @ApiOperation({ summary: 'Link (or change) the bank account of my wallet' })
  async link(
    @Body() dto: LinkWalletDto,
    @CurrentUser() user: UserPayload
  ): Promise<WalletView> {
    const userId = this.requireUserId(user)
    const { wallet } = await this.walletsService.link(userId, dto)
    await this.payoutsService.releaseAwaitingWallet(userId)
    return wallet
  }

  @Get('transactions')
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
  @ApiOperation({ summary: 'Platform-fee invoices I can pay from my balance' })
  invoices(@CurrentUser() user: UserPayload): Promise<PayableInvoice[]> {
    return this.walletsService.listPayableInvoices(this.requireUserId(user))
  }

  private requireUserId(user: UserPayload): string {
    if (!user._id) throw new UnauthorizedException('USER_ID_REQUIRED')
    return user._id
  }
}
