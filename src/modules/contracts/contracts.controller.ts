import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IsString, IsNumber, IsNotEmpty, Min, Max } from 'class-validator'
import { ContractsService } from './contracts.service'
import { Contract } from './schemas/contract.schema'

export class CreateContractDto {
  @IsString()
  @IsNotEmpty()
  propertyId!: string

  @IsString()
  @IsNotEmpty()
  propertyTitle!: string

  @IsString()
  propertyAddress?: string

  @IsNumber()
  propertyArea?: number

  @IsString()
  propertyFurniture?: string

  @IsNumber()
  @Min(0)
  propertyValue!: number

  @IsString()
  @IsNotEmpty()
  landlordId!: string

  @IsString()
  landlordName?: string

  @IsString()
  landlordCccd?: string

  @IsString()
  landlordAddress?: string

  @IsString()
  @IsNotEmpty()
  tenantId!: string

  @IsString()
  tenantName?: string

  @IsString()
  tenantCccd?: string

  @IsString()
  tenantAddress?: string

  @IsString()
  @IsNotEmpty()
  startDate!: string

  @IsString()
  @IsNotEmpty()
  endDate!: string

  @IsNumber()
  @Min(0)
  monthlyRent!: number

  @IsNumber()
  @Min(0)
  deposit!: number

  @IsNumber()
  @Min(1)
  @Max(31)
  paymentDay!: number

  @IsNumber()
  @Min(0)
  latePenaltyRate!: number

  @IsNumber()
  @Min(0)
  terminationNoticeDays!: number
}

export class SignContractDto {
  @IsString()
  @IsNotEmpty()
  role!: 'tenant' | 'landlord'
}

@ApiTags('contracts')
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  async create(@Body() dto: CreateContractDto): Promise<Contract> {
    return this.contractsService.createContract(dto)
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Contract> {
    return this.contractsService.findOne(id)
  }

  @Get()
  async findByUser(@Query('userId') userId: string): Promise<Contract[]> {
    return this.contractsService.findByUser(userId)
  }

  @Put(':id/sign')
  async sign(
    @Param('id') id: string,
    @Body() dto: SignContractDto
  ): Promise<Contract> {
    return this.contractsService.signContract(id, dto.role)
  }

  @Get(':id/verify')
  async verify(@Param('id') id: string): Promise<{
    isValid: boolean
    currentHash: string
    storedHash: string | null
    blockchainAddress: string | null
  }> {
    return this.contractsService.verifyIntegrity(id)
  }
}
