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
import { ApiTags, ApiBearerAuth, ApiProduces } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  IsInt,
  IsObject,
  MaxLength,
} from 'class-validator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ContractsService } from './contracts.service'
import { Contract } from './schemas/contract.schema'
import { ContractArtifactService } from './contract-artifact.service'
import type { PublicServiceChecklist } from './legal/public-service-checklist'

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
  signingGrantId!: string
}

export class IssueSigningGrantDto {
  @IsString()
  @IsNotEmpty()
  biometricGrantId!: string

  @IsString()
  @IsNotEmpty()
  otpSessionId!: string
}

export class SaveContractContentDto {
  @IsObject()
  content!: Record<string, unknown>

  @IsInt()
  @Min(0)
  expectedRevision!: number
}

export class LockContractContentDto {
  @IsInt()
  @Min(0)
  expectedRevision!: number
}

export class TerminateContractDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  reasonCode!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey!: string
}

// ── Controller ──

@ApiTags('contracts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly artifactService: ContractArtifactService
  ) {}

  /** Tạo hợp đồng nháp — chỉ Admin và Nhân viên */
  @Post()
  @Roles('admin', 'staff')
  async create(@Body() dto: CreateContractDto): Promise<Contract> {
    return this.contractsService.createContract(dto)
  }

  @Get(':id/public-service-checklist')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async publicServiceChecklist(
    @Param('id') id: string,
    @Query('purpose') purpose: string | undefined,
    @CurrentUser() user: UserPayload
  ): Promise<PublicServiceChecklist> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.contractsService.getPublicServiceChecklistForUser(
      id,
      user._id ?? '',
      isStaff,
      purpose
    )
  }

  /** Lấy chi tiết một hợp đồng — Admin, Nhân viên, Chủ nhà, Khách thuê */
  @Get(':id')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<Contract> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.contractsService.findOneForUser(id, user._id ?? '', isStaff)
  }

  @Get(':id/pdf')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  @ApiProduces(
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
  async downloadArtifact(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @CurrentUser() user: UserPayload
  ): Promise<Buffer> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.artifactService.generateDocument(
      id,
      user._id ?? '',
      isStaff,
      format ?? 'pdf'
    )
  }

  /** Lấy danh sách hợp đồng theo userId — Admin, Nhân viên, Chủ nhà, Khách thuê */
  @Get()
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async findByUser(
    @Query('userId') requestedUserId: string,
    @CurrentUser() user: UserPayload
  ): Promise<Contract[]> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    const userId =
      isStaff && requestedUserId ? requestedUserId : (user._id ?? '')
    return this.contractsService.findByUser(userId)
  }

  /** Ký hợp đồng (tenant hoặc landlord) — yêu cầu KYC đã verified */
  @Put(':id/sign')
  @Roles('landlord', 'tenant')
  async sign(
    @Param('id') id: string,
    @Body() dto: SignContractDto,
    @CurrentUser('id') userId: string
  ): Promise<Contract> {
    return this.contractsService.signContractForUser(
      id,
      userId,
      dto.signingGrantId
    )
  }

  @Put(':id/content')
  @Roles('admin', 'staff', 'landlord')
  saveContent(
    @Param('id') id: string,
    @Body() dto: SaveContractContentDto,
    @CurrentUser() user: UserPayload
  ): Promise<Contract> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.contractsService.saveContractContent(
      id,
      user._id ?? '',
      dto.content,
      dto.expectedRevision,
      isStaff
    )
  }

  @Post(':id/lock-content')
  @Roles('admin', 'staff')
  lockContent(
    @Param('id') id: string,
    @Body() dto: LockContractContentDto,
    @CurrentUser('id') actorId: string
  ): Promise<Contract> {
    return this.contractsService.lockContractContent(
      id,
      actorId,
      dto.expectedRevision,
      true
    )
  }

  @Post(':id/terminate')
  @Roles('admin', 'staff')
  terminate(
    @Param('id') id: string,
    @Body() dto: TerminateContractDto,
    @CurrentUser('id') actorId: string
  ): Promise<Contract> {
    return this.contractsService.terminateContract(
      id,
      actorId,
      dto.reasonCode,
      dto.reason,
      dto.idempotencyKey
    )
  }

  @Post(':id/signing-grant')
  @Roles('landlord', 'tenant')
  async issueSigningGrant(
    @Param('id') id: string,
    @Body() dto: IssueSigningGrantDto,
    @CurrentUser('id') userId: string
  ): Promise<{ grantId: string; expiresAt: Date }> {
    return this.contractsService.issueSigningGrant(
      id,
      userId,
      dto.biometricGrantId,
      dto.otpSessionId
    )
  }

  /** Xác minh tính toàn vẹn hợp đồng với Hyperledger Fabric */
  @Get(':id/verify')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async verify(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<{
    isValid: boolean
    currentHash: string
    storedHash: string | null
    blockchainAddress: string | null
    onChain: unknown
  }> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.contractsService.verifyIntegrityForUser(
      id,
      user._id ?? '',
      isStaff
    )
  }

  /** Xác thực khuôn mặt người ký trước khi ký hợp đồng */
  @Post(':id/verify-signer')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  @UseInterceptors(FileInterceptor('selfie'))
  async verifySigner(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @UploadedFile() file?: Express.Multer.File
  ): Promise<{
    verified: boolean
    faceMatch: boolean
    liveness: boolean
    spoofScore: number | null
  }> {
    if (!file) throw new BadRequestException('Thiếu file selfie')
    return this.contractsService.verifySignerForUser(id, userId, file)
  }
}
