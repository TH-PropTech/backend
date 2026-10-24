import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  PayoutsService,
  type PayoutListResult,
} from '../services/payouts.service'
import {
  payoutSettlementOf,
  type Payout,
  type PayoutSettlement,
} from '../schemas/payout.schema'
import type { ContractPayoutSummaryDto } from '../dto/contract-payout-summary.dto'
import { RequirePermission } from '../../rbac/guards/require-permission.decorator'

export class ReportPayoutIssueBody {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}

export class MarkSettledExternallyBody {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}

type PayoutView = Payout & { settlement: PayoutSettlement }

const withSettlement = (payout: Payout): PayoutView => ({
  ...payout,
  settlement: payoutSettlementOf(payout),
})

@ApiTags('payouts')
@ApiBearerAuth()
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Get('me')
  @RequirePermission('read', 'Payout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  @ApiOperation({ summary: 'List payouts received by the current landlord' })
  listMine(
    @CurrentUser() user: UserPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ): Promise<Omit<PayoutListResult, 'items'> & { items: PayoutView[] }> {
    return this.payoutsService
      .listForLandlord(this.requireUserId(user), Number(page), Number(limit))
      .then(result => ({
        ...result,
        items: (result.items ?? []).map(withSettlement),
      }))
  }

  @Get('by-tx/:txRef')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  @ApiOperation({ summary: 'Get one of my payouts by transfer reference' })
  getByTxRef(
    @Param('txRef') txRef: string,
    @CurrentUser() user: UserPayload
  ): Promise<PayoutView> {
    return this.payoutsService
      .getByTxRefForLandlord(txRef, this.requireUserId(user))
      .then(withSettlement)
  }

  @Get(':id')
  @RequirePermission('read', 'Payout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  @ApiOperation({ summary: 'Get one of my payouts' })
  getOne(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<PayoutView> {
    return this.payoutsService
      .getForLandlord(id, this.requireUserId(user))
      .then(withSettlement)
  }

  @Get('contracts/:contractId/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord', 'staff', 'admin')
  @ApiOperation({
    summary:
      'Tổng hợp khoản chủ nhà nhận theo hợp đồng (cọc, kỳ thuê, trạng thái ví)',
  })
  getContractSummary(
    @Param('contractId') contractId: string,
    @CurrentUser() user: UserPayload
  ): Promise<ContractPayoutSummaryDto> {
    const roles = user.roles ?? []
    const isLandlordScoped =
      roles.includes('landlord') &&
      !roles.includes('staff') &&
      !roles.includes('admin')
    return this.payoutsService.getContractSummary(contractId, {
      userId: this.requireUserId(user),
      isLandlordScoped,
    })
  }

  @Post(':id/retry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Retry a failed payout (admin)' })
  retry(@Param('id') id: string): Promise<Payout> {
    return this.payoutsService.retry(id)
  }

  @Post(':id/report-issue')
  @RequirePermission('update', 'Payout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  @ApiOperation({
    summary: 'Chủ nhà báo vấn đề với khoản tiền (một lần, báo admin)',
  })
  reportIssue(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
    @Body() body: ReportPayoutIssueBody
  ): Promise<PayoutView> {
    return this.payoutsService
      .reportIssue(id, this.requireUserId(user), body?.note)
      .then(withSettlement)
  }

  @Post(':id/mark-settled-externally')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary:
      'Admin đánh dấu khoản qua cổng thật đã xử lý ngoài hệ thống (409 nếu không phải external/pending)',
  })
  markSettledExternally(
    @Param('id') id: string,
    @Body() body: MarkSettledExternallyBody
  ): Promise<PayoutView> {
    return this.payoutsService
      .markSettledExternally(id, body?.note)
      .then(withSettlement)
  }

  private requireUserId(user: UserPayload): string {
    if (!user._id) throw new UnauthorizedException('USER_ID_REQUIRED')
    return user._id
  }
}
