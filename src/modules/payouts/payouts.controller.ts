import {
  Controller,
  Get,
  Param,
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
import { PayoutsService, type PayoutListResult } from './payouts.service'
import type { Payout } from './schemas/payout.schema'

@ApiTags('payouts')
@ApiBearerAuth()
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  @ApiOperation({ summary: 'List payouts received by the current landlord' })
  listMine(
    @CurrentUser() user: UserPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ): Promise<PayoutListResult> {
    return this.payoutsService.listForLandlord(
      this.requireUserId(user),
      Number(page),
      Number(limit)
    )
  }

  @Get('by-tx/:txRef')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  @ApiOperation({ summary: 'Get one of my payouts by transfer reference' })
  getByTxRef(
    @Param('txRef') txRef: string,
    @CurrentUser() user: UserPayload
  ): Promise<Payout> {
    return this.payoutsService.getByTxRefForLandlord(
      txRef,
      this.requireUserId(user)
    )
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  @ApiOperation({ summary: 'Get one of my payouts' })
  getOne(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<Payout> {
    return this.payoutsService.getForLandlord(id, this.requireUserId(user))
  }

  @Post(':id/retry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Retry a failed payout (admin)' })
  retry(@Param('id') id: string): Promise<Payout> {
    return this.payoutsService.retry(id)
  }

  private requireUserId(user: UserPayload): string {
    if (!user._id) throw new UnauthorizedException('USER_ID_REQUIRED')
    return user._id
  }
}
