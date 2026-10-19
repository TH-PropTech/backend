import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import {
  AdminPaymentsService,
  type AdminPaymentRow,
  type AdminPaymentsFilter,
  type AdminPaymentsPage,
} from '../services/admin-payments.service'
import type { PaymentProviderName } from '../../mock-bank/providers/payment-provider.port'
import type { PaymentAttemptStatus } from '../schemas/payment-attempt.schema'
import type { PayoutStatus } from '../../wallets/schemas/payout.schema'

@ApiTags('admin-payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('staff', 'admin')
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly service: AdminPaymentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lịch sử thanh toán & đối soát trên mọi hợp đồng',
  })
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('provider') provider?: string,
    @Query('status') status?: string,
    @Query('payoutStatus') payoutStatus?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string
  ): Promise<AdminPaymentsPage> {
    const filter: AdminPaymentsFilter = {}
    if (page) filter.page = Number(page)
    if (limit) filter.limit = Number(limit)
    if (provider) filter.provider = provider as PaymentProviderName
    if (status) filter.status = status as PaymentAttemptStatus
    if (payoutStatus) filter.payoutStatus = payoutStatus as PayoutStatus
    if (from) filter.from = new Date(from)
    if (to) filter.to = new Date(to)
    if (q) filter.q = q
    return this.service.list(filter)
  }

  @Post(':txRef/recheck')
  @ApiOperation({
    summary:
      'Đối soát một giao dịch với API truy vấn của cổng thật (VNPay/MoMo/ZaloPay) rồi trả dòng mới nhất; chỉ ghi kết quả đối soát, không đổi trạng thái thanh toán/payout',
  })
  async recheck(@Param('txRef') txRef: string): Promise<AdminPaymentRow> {
    const row = await this.service.recheck(txRef)
    if (!row) throw new NotFoundException('PAYMENT_ATTEMPT_NOT_FOUND')
    return row
  }
}
