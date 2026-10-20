import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import {
  WalletsService,
  type LandlordWalletPage,
} from '../services/wallets.service'

@ApiTags('admin-wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/wallets')
export class AdminWalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get('landlords')
  @ApiOperation({
    summary: 'Every landlord and whether their payout wallet is linked',
  })
  landlords(
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ): Promise<LandlordWalletPage> {
    return this.walletsService.listLandlordWallets(Number(page), Number(limit))
  }
}
