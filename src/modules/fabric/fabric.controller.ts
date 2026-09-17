import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  BadRequestException,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { IsString, IsArray, IsOptional } from 'class-validator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import { FabricService } from './fabric.service'
import { BlockchainLog } from './schemas/blockchain-log.schema'
import { LedgerOutboxService } from './ledger-outbox.service'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'

// ── DTOs ──

export class SubmitTxDto {
  @IsString()
  action!: string

  @IsArray()
  @IsString({ each: true })
  args!: string[]

  @IsOptional()
  @IsString()
  contractId?: string

  @IsOptional()
  @IsString()
  paymentId?: string
}

export class QueryTxDto {
  @IsString()
  action!: string

  @IsArray()
  @IsString({ each: true })
  args!: string[]
}

export class FabricStatusResponseDto {
  mode!: 'simulation' | 'fabric'
  connectionState!: 'disabled' | 'connected' | 'unavailable'
  ready!: boolean
  channel?: string | undefined
  chaincode?: string | undefined
  lastCheckedAt!: string
  errorCode?: string | null
}

// ── Controller ──

@ApiTags('fabric')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('fabric')
export class FabricController {
  constructor(
    private readonly fabricService: FabricService,
    private readonly ledgerOutboxService: LedgerOutboxService,
    @InjectRepository(BlockchainLog)
    private readonly logRepository: Repository<BlockchainLog>
  ) {}

  /** Trạng thái kết nối Hyperledger Fabric — Admin, Nhân viên */
  @Get('status')
  @Roles('admin', 'staff')
  getStatus(): FabricStatusResponseDto {
    return this.fabricService.getStatus()
  }

  /** Retry terminal failed outbox event — Admin, Nhân viên */
  @Post('outbox/:id/retry')
  @Roles('admin', 'staff')
  async retryOutboxEvent(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<LedgerOutbox> {
    const role = user?.roles?.includes('admin')
      ? 'admin'
      : user?.roles?.includes('staff')
        ? 'staff'
        : 'unknown'
    return this.ledgerOutboxService.retryTerminal(id, role)
  }

  /** Submit transaction lên blockchain — chỉ Admin */
  @Post('submit')
  @Roles('admin')
  async submitTx(@Body() dto: SubmitTxDto): Promise<{
    txHash: string
    blockNumber: number | null
    success: boolean
    networkMode: 'simulation' | 'fabric'
  }> {
    try {
      return await this.fabricService.submitTransaction(dto.action, dto.args, {
        contractId: dto.contractId,
        paymentId: dto.paymentId,
      })
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      throw new BadRequestException(`Giao dịch blockchain thất bại: ${errMsg}`)
    }
  }

  /** Truy vấn dữ liệu từ blockchain (read-only) — Admin, Nhân viên */
  @Post('query')
  @Roles('admin', 'staff')
  async queryTx(@Body() dto: QueryTxDto): Promise<unknown> {
    try {
      return await this.fabricService.evaluateTransaction(dto.action, dto.args)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      throw new BadRequestException(`Truy vấn blockchain thất bại: ${errMsg}`)
    }
  }

  /** Xem lịch sử log giao dịch blockchain — Admin, Nhân viên */
  @Get('logs')
  @Roles('admin', 'staff')
  async getLogs(
    @Query('contractId') contractId?: string,
    @Query('paymentId') paymentId?: string
  ): Promise<BlockchainLog[]> {
    const filter: Record<string, string> = {}
    if (contractId) filter.contractId = contractId
    if (paymentId) filter.paymentId = paymentId

    return this.logRepository.find({
      where: filter,
      order: { createdAt: 'DESC' },
    })
  }
}
