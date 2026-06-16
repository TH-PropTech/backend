import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { IsString, IsArray, IsOptional } from 'class-validator'
import { FabricService } from './fabric.service'
import { BlockchainLog } from './schemas/blockchain-log.schema'

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

@ApiTags('fabric')
@Controller('fabric')
export class FabricController {
  constructor(
    private readonly fabricService: FabricService,
    @InjectRepository(BlockchainLog)
    private readonly logRepository: Repository<BlockchainLog>
  ) {}

  @Get('status')
  getStatus(): {
    mode: 'simulation' | 'fabric'
    channel?: string | undefined
    chaincode?: string | undefined
  } {
    return this.fabricService.getStatus()
  }

  @Post('submit')
  async submitTx(
    @Body() dto: SubmitTxDto
  ): Promise<{ txHash: string; blockNumber: number; success: boolean }> {
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

  @Post('query')
  async queryTx(@Body() dto: QueryTxDto): Promise<unknown> {
    try {
      return await this.fabricService.evaluateTransaction(dto.action, dto.args)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      throw new BadRequestException(`Truy vấn blockchain thất bại: ${errMsg}`)
    }
  }

  @Get('logs')
  async getLogs(
    @Query('contractId') contractId?: string,
    @Query('paymentId') paymentId?: string
  ): Promise<BlockchainLog[]> {
    const filter: Record<string, string> = {}
    if (contractId) {
      filter.contractId = contractId
    }
    if (paymentId) {
      filter.paymentId = paymentId
    }
    return this.logRepository.find({
      where: filter,
      order: { createdAt: 'DESC' },
    })
  }
}
