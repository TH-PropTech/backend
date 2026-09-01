import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import { IsString, IsNotEmpty, IsNumber, Min, Max, IsIn } from 'class-validator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { ContractsService } from './contracts.service'
import { Contract } from './schemas/contract.schema'

// ── DTOs ──

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
  @IsIn(['tenant', 'landlord'])
  role!: 'tenant' | 'landlord'
}

// ── Controller ──

@ApiTags('contracts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  /** Tạo hợp đồng nháp — chỉ Admin và Nhân viên */
  @Post()
  @Roles('admin', 'staff')
  async create(@Body() dto: CreateContractDto): Promise<Contract> {
    return this.contractsService.createContract(dto)
  }

  /** Lấy chi tiết một hợp đồng — Admin, Nhân viên, Chủ nhà, Khách thuê */
  @Get(':id')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async findOne(@Param('id') id: string): Promise<Contract> {
    return this.contractsService.findOne(id)
  }

  /** Lấy danh sách hợp đồng theo userId — Admin, Nhân viên, Chủ nhà, Khách thuê */
  @Get()
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async findByUser(@Query('userId') userId: string): Promise<Contract[]> {
    return this.contractsService.findByUser(userId)
  }

  /** Ký hợp đồng (tenant hoặc landlord) — yêu cầu KYC đã verified */
  @Put(':id/sign')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async sign(
    @Param('id') id: string,
    @Body() dto: SignContractDto
  ): Promise<Contract> {
    return this.contractsService.signContract(id, dto.role)
  }

  /** Xác minh tính toàn vẹn hợp đồng với Hyperledger Fabric */
  @Get(':id/verify')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async verify(@Param('id') id: string): Promise<{
    isValid: boolean
    currentHash: string
    storedHash: string | null
    blockchainAddress: string | null
    onChain: unknown
  }> {
    return this.contractsService.verifyIntegrity(id)
  }

  /** Xác thực khuôn mặt người ký trước khi ký hợp đồng */
  @Post(':id/verify-signer')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  @UseInterceptors(FileInterceptor('selfie'))
  async verifySigner(
    @Param('id') id: string,
    @Body('role') role: 'tenant' | 'landlord',
    @UploadedFile() file: Express.Multer.File
  ): Promise<{
    verified: boolean
    faceMatch: boolean
    liveness: boolean
    spoofScore: number
  }> {
    if (!file) throw new BadRequestException('Thiếu file selfie')
    if (!role) throw new BadRequestException('Thiếu tham số role')
    return this.contractsService.verifySigner(id, role, file)
  }
}
