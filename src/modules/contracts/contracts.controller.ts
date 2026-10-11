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
  ConflictException,
  ForbiddenException,
  Optional,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  ApiTags,
  ApiBearerAuth,
  ApiProduces,
  ApiConsumes,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import { ConfigService } from '@nestjs/config'
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  IsInt,
  IsObject,
  MaxLength,
  IsOptional,
} from 'class-validator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { ContractsService } from './contracts.service'
import { Contract } from './schemas/contract.schema'
import { ContractArtifactService } from './contract-artifact.service'
import { ContractEvidencePackageExportService } from './contract-evidence-package.export.service'
import { EvidencePackageQueryDto } from './dto/evidence-package-query.dto'
import type { PublicServiceChecklist } from './legal/public-service-checklist'
import { ContractViewService } from './contract-view.service'
import { LedgerAuditQueryService } from '../fabric/ledger-audit-query.service'
import {
  LedgerEvidenceDto,
  LedgerEvidenceQueryService,
} from '../fabric/ledger-evidence-query.service'
import { SmartOtpService } from '../smart-otp/services/smart-otp.service'
import { OtpActionType } from '../smart-otp/enums/otp-action-type.enum'
import type { ContractViewDto } from './dto/contract-view.dto'
import type { ContractAuditEventDto } from './dto/contract-audit-event.dto'
import { SmartCaSigningService } from './smartca/smartca-signing.service'
import { DepositAgreementsService } from './deposit-agreements.service'
import { DepositAgreement } from './schemas/deposit-agreement.schema'
import type { ContractArtifact } from './schemas/contract-artifact.schema'
import type { Response } from 'express'
import {
  CreateSmartCaSigningSessionDto,
  SignSmartCaV2Dto,
  SigningMethodOptionDto,
  SmartCaCertificateListDto,
  SmartCaSigningSessionDto,
  toSmartCaCertificateListDto,
  toSmartCaSigningSessionDto,
} from './dto/smartca-signing.dto'

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

/**
 * Payload webhook của VNPT SmartCA (§3.5). Mọi trường là dữ liệu không tin
 * cậy: chữ ký/trạng thái không được dùng để ghi nhận, chỉ `transaction_id`
 * dùng để biết giao dịch nào cần đối soát lại qua status API.
 */
export class SmartCaWebhookDto {
  @IsString()
  @IsNotEmpty()
  sp_id!: string

  @IsNotEmpty()
  status_code!: number | string

  @IsString()
  @IsNotEmpty()
  message!: string

  @IsOptional()
  @IsString()
  transaction_id?: string

  @IsOptional()
  @IsObject({ each: true })
  signed_files?: Record<string, unknown>[]
}

// ── Controller ──

@ApiTags('contracts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly artifactService: ContractArtifactService,
    private readonly contractViewService: ContractViewService,
    private readonly ledgerAuditQueryService: LedgerAuditQueryService,
    private readonly ledgerEvidenceQueryService: LedgerEvidenceQueryService,
    private readonly smartOtpService: SmartOtpService,
    private readonly smartCaSigningService: SmartCaSigningService,
    @Optional()
    private readonly depositAgreementsService?: DepositAgreementsService,
    @Optional()
    private readonly evidencePackageExportService?: ContractEvidencePackageExportService,
    @Optional()
    private readonly configService?: ConfigService
  ) {}

  /** Lấy chi tiết hợp đồng phong phú cho Contract Workspace */
  @Get(':id/view')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async getContractView(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<ContractViewDto> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.contractViewService.getForActor(id, user._id ?? '', isStaff)
  }

  /** Lấy lịch sử sự kiện sổ cái và outbox cho hợp đồng */
  @Get(':id/audit-events')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async getContractAuditEvents(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<ContractAuditEventDto[]> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    await this.contractsService.findOneForUser(id, user._id ?? '', isStaff)
    return this.ledgerAuditQueryService.getContractEvents(id)
  }

  /** Lấy bằng chứng ledger đã làm sạch theo toàn bộ aggregate của hợp đồng */
  @Get(':id/ledger-evidence')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async getContractLedgerEvidence(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<LedgerEvidenceDto> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    const contract = await this.contractsService.findOneForUser(
      id,
      user._id ?? '',
      isStaff
    )
    return this.ledgerEvidenceQueryService.getContractLedgerEvidence(
      id,
      contract
    )
  }

  /** Khởi tạo Smart OTP challenge cho ký hợp đồng */
  @Post(':id/otp-challenge')
  @Roles('landlord', 'tenant')
  async initiateSigningOtp(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body('deviceId') deviceId?: string
  ): Promise<{
    sessionId: string
    challenge: string
    expiredAt: Date
    otpCode?: string
  }> {
    const contract = await this.contractsService.findOne(id)
    const role =
      contract.tenantId === userId
        ? 'tenant'
        : contract.landlordId === userId
          ? 'landlord'
          : null
    if (!role) throw new ForbiddenException('CONTRACT_SIGN_ACCESS_DENIED')
    if (!contract.contentLockedHash) {
      throw new BadRequestException('CONTRACT_CONTENT_NOT_LOCKED')
    }

    const resolvedDeviceId = deviceId || `WEB_BROWSER_${userId}`
    return this.smartOtpService.initiateOtpSession(
      userId,
      resolvedDeviceId,
      OtpActionType.CONTRACT_SIGN,
      {
        contractId: id,
        signerRole: role,
        contentLockedHash: contract.contentLockedHash,
      }
    )
  }

  /** Xác thực Smart OTP signature */
  @Post(':id/verify-otp')
  @Roles('landlord', 'tenant')
  async verifySigningOtp(
    @Param('id') _id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { sessionId: string; otpCode: string; signature?: string }
  ): Promise<{ success: boolean; message: string }> {
    return this.smartOtpService.verifyOtpSignature(
      userId,
      body.sessionId,
      body.otpCode,
      body.signature || 'WEB_SIMULATED_SIG'
    )
  }

  /** Tạo hợp đồng nháp — chỉ Admin và Nhân viên */
  @Post()
  @Roles('admin', 'staff')
  async create(@Body() dto: CreateContractDto): Promise<Contract> {
    return this.contractsService.createContract(dto)
  }

  @Post(':id/deposit-agreement')
  @Roles('admin', 'staff')
  @ApiCreatedResponse({ type: DepositAgreement })
  async createDepositAgreement(
    @Param('id') id: string
  ): Promise<DepositAgreement> {
    if (!this.depositAgreementsService) {
      throw new ConflictException('DEPOSIT_AGREEMENT_SERVICE_UNAVAILABLE')
    }
    return this.depositAgreementsService.createForContract(id)
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

  /**
   * PROP-399 D8: gói bằng chứng tranh chấp (ZIP) — stream từ GridFS, không nạp PDF/gói vào RAM.
   * Quyền: participant của hợp đồng, staff, admin (quan hệ hợp đồng được kiểm tra trong service).
   */
  @Get(':id/evidence-package')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  @ApiProduces('application/zip')
  @ApiOperation({
    summary:
      'Tải gói bằng chứng hợp đồng (ZIP có manifest, hash từng tệp và báo cáo xác minh 3 lớp)',
  })
  @ApiOkResponse({
    description:
      'Gói ZIP (manifest.json, verification-report.json, contract/contract-r<rev>.pdf, evidence/*.json)',
    content: {
      'application/zip': { schema: { type: 'string', format: 'binary' } },
    },
    headers: {
      'Content-Disposition': {
        description:
          'attachment; filename="evidence-<mã hợp đồng>-r<revision>.zip"',
        schema: { type: 'string' },
      },
      'X-Evidence-Package-Hash': {
        description:
          'packageHash logic (SHA-256) của manifest — bằng chứng di động của gói',
        schema: { type: 'string' },
      },
      'X-Evidence-Package-Revision': {
        description: 'Revision artifact canonical trong gói',
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'revision không hợp lệ' })
  @ApiForbiddenResponse({
    description:
      'CONTRACT_ACCESS_DENIED — không phải participant hay nhân sự được phép',
  })
  @ApiNotFoundResponse({
    description: 'CONTRACT_NOT_FOUND | EVIDENCE_VERSION_NOT_FOUND',
  })
  @ApiConflictResponse({
    description:
      'EVIDENCE_ARTIFACT_MISMATCH — bytes lưu trữ không khớp hash canonical',
  })
  @ApiResponse({
    status: 413,
    description: 'EVIDENCE_PACKAGE_TOO_LARGE (kèm limit: maxFiles | maxBytes)',
  })
  @ApiUnprocessableEntityResponse({
    description: 'EVIDENCE_PACKAGE_INCOMPLETE — thiếu artifact ký chuẩn',
  })
  async downloadEvidencePackage(
    @Param('id') id: string,
    @Query() query: EvidencePackageQueryDto,
    @CurrentUser() user: UserPayload,
    @Res() response: Response
  ): Promise<void> {
    if (!this.evidencePackageExportService) {
      throw new ServiceUnavailableException('EVIDENCE_PACKAGE_UNAVAILABLE')
    }
    // Mọi kiểm tra quyền/toàn vẹn/giới hạn xảy ra ở prepare() — trước khi gửi byte đầu tiên.
    const prepared = await this.evidencePackageExportService.prepare(
      id,
      { id: user._id ?? '', roles: user.roles ?? [] },
      { revision: query.revision }
    )

    const headers: Record<string, string> = {
      'Content-Type': prepared.contentType,
      'Content-Disposition': `attachment; filename="${prepared.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Evidence-Package-Hash': prepared.packageHash,
      'X-Evidence-Package-Revision': String(prepared.revision),
    }
    for (const [name, value] of Object.entries(headers)) {
      response.setHeader(name, value)
    }

    const abort = new AbortController()
    const onClose = (): void => {
      if (!response.writableFinished) abort.abort()
    }
    response.once('close', onClose)
    try {
      await prepared.run(response, abort.signal)
    } catch (error) {
      if (!response.headersSent) {
        for (const name of Object.keys(headers)) response.removeHeader(name)
        throw error
      }
      // Đã gửi một phần: kết nối đã bị huỷ bởi lớp ghi; không thể gửi JSON lỗi nữa.
    } finally {
      response.off('close', onClose)
    }
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
    @CurrentUser() user: UserPayload,
    // Ghi byte trực tiếp: nếu trả Buffer qua handler, ResponseEnvelopeInterceptor sẽ bọc thành JSON
    // và trình xem PDF/tải về nhận được JSON thay vì file.
    @Res() response: Response
  ): Promise<void> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    const resolved = await this.artifactService.generateDocumentWithMetadata(
      id,
      user._id ?? '',
      isStaff,
      format ?? 'pdf'
    )
    const safeFormat = format === 'docx' ? 'docx' : 'pdf'
    response.setHeader(
      'Content-Type',
      safeFormat === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader(
      'X-Contract-Artifact-Revision',
      String(resolved.reference.revision)
    )
    response.setHeader(
      'X-Contract-Artifact-Hash',
      resolved.reference.artifactHash
    )
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="contract-${id}-r${resolved.reference.revision}.${safeFormat}"`
    )
    response.setHeader('Content-Length', String(resolved.bytes.length))
    response.status(200).end(resolved.bytes)
  }

  @Post(':id/smartca/signing-sessions')
  @Roles('landlord', 'tenant')
  @ApiCreatedResponse({ type: SmartCaSigningSessionDto })
  async createSmartCaSigningSession(
    @Param('id') id: string,
    @CurrentUser('id') signerId: string,
    @Body() dto: CreateSmartCaSigningSessionDto
  ): Promise<SmartCaSigningSessionDto> {
    const session = await this.smartCaSigningService.createSession(
      id,
      signerId,
      dto
    )
    return toSmartCaSigningSessionDto(session)
  }

  @Get(':id/signing-methods')
  @Roles('landlord', 'tenant')
  @ApiOkResponse({ type: [SigningMethodOptionDto] })
  listSigningMethods(
    @Param('id') id: string,
    @CurrentUser('id') signerId: string
  ): Promise<SigningMethodOptionDto[]> {
    return this.smartCaSigningService.listSigningMethods(id, signerId)
  }

  @Post(':id/smartca/sign-v2')
  @Roles('landlord', 'tenant')
  @ApiCreatedResponse({ type: SmartCaSigningSessionDto })
  async signSmartCaV2(
    @Param('id') id: string,
    @CurrentUser('id') signerId: string,
    @Body() dto: SignSmartCaV2Dto
  ): Promise<SmartCaSigningSessionDto> {
    const session = await this.smartCaSigningService.createSessionV2(
      id,
      signerId,
      {
        password: dto.smartCaPassword,
        otp: dto.smartCaOtp,
        ...(dto.idempotencyKey ? { idempotencyKey: dto.idempotencyKey } : {}),
        ...(dto.certificateSerial
          ? { certificateSerial: dto.certificateSerial }
          : {}),
      }
    )
    return toSmartCaSigningSessionDto(session)
  }

  @Get(':id/smartca/certificates')
  @Roles('landlord', 'tenant')
  @ApiOkResponse({ type: SmartCaCertificateListDto })
  async listSmartCaCertificates(
    @Param('id') id: string,
    @CurrentUser('id') signerId: string
  ): Promise<SmartCaCertificateListDto> {
    const result = await this.smartCaSigningService.listCertificates(
      id,
      signerId
    )
    return toSmartCaCertificateListDto(result.certificates)
  }

  @Get(':id/smartca/signing-sessions/:sessionId')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async getSmartCaSigningSession(
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: UserPayload
  ): Promise<SmartCaSigningSessionDto> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    const session = await this.smartCaSigningService.getSession(
      id,
      sessionId,
      user._id ?? '',
      isStaff
    )
    return toSmartCaSigningSessionDto(session)
  }

  @Post(':id/smartca/signing-sessions/:sessionId/poll')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async pollSmartCaSigningSession(
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: UserPayload
  ): Promise<SmartCaSigningSessionDto> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    const session = await this.smartCaSigningService.poll(
      id,
      sessionId,
      user._id ?? '',
      isStaff
    )
    return toSmartCaSigningSessionDto(session)
  }

  @Post(':id/smartca/signing-sessions/:sessionId/cancel')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async cancelSmartCaSigningSession(
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: UserPayload
  ): Promise<SmartCaSigningSessionDto> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    const session = await this.smartCaSigningService.cancelSession(
      id,
      sessionId,
      user._id ?? '',
      isStaff
    )
    return toSmartCaSigningSessionDto(session)
  }

  /**
   * Webhook của VNPT SmartCA (§3.5). Không có header/secret để xác thực
   * theo tài liệu, nên response luôn `200` không tiết lộ phiên có tồn tại
   * hay không; chữ ký chỉ được ghi nhận sau khi `handleWebhook` xác minh
   * lại bằng status API.
   */
  @Post('smartca/callback')
  @Public()
  @ApiOperation({
    summary: 'Webhook do VNPT SmartCA gọi (không dành cho client)',
    description:
      'VNPT gọi endpoint này khi người ký duyệt giao dịch trong app SmartCA. ' +
      'Payload không được tin cậy: chỉ `transaction_id` được dùng để đối soát lại ' +
      'qua status API của VNPT. Luôn trả 200 để không lộ phiên có tồn tại hay không.',
  })
  @ApiOkResponse({ description: 'Luôn trả `{ received: true }`.' })
  async smartCaCallback(
    @Body() body: SmartCaWebhookDto
  ): Promise<{ received: true }> {
    const expectedSpId = this.configService?.get<string>('smartCA.spId')
    if (
      body.sp_id === expectedSpId &&
      body.transaction_id &&
      body.transaction_id.trim()
    ) {
      await this.smartCaSigningService.handleWebhook(body.transaction_id)
    }
    return { received: true }
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

  /** Dev/test: ký bỏ qua SmartCA. Bị chặn trừ khi ENABLE_TEST_SIGN_BYPASS=true và không phải production. */
  @Post(':id/test-sign')
  @Roles('landlord', 'tenant')
  async testSign(
    @Param('id') id: string,
    @CurrentUser('id') userId: string
  ): Promise<Contract> {
    return this.contractsService.signContractForTest(id, userId)
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
  @Roles('admin', 'staff', 'landlord')
  lockContent(
    @Param('id') id: string,
    @Body() dto: LockContractContentDto,
    @CurrentUser() user: UserPayload
  ): Promise<Contract> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.contractsService.lockContractContent(
      id,
      user._id ?? '',
      dto.expectedRevision,
      isStaff
    )
  }

  @Post(':id/artifacts/lock')
  @Roles('admin', 'staff', 'landlord')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('artifact'))
  lockCanonicalArtifact(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
    @UploadedFile() artifact?: Express.Multer.File
  ): Promise<ContractArtifact> {
    if (!artifact?.buffer) {
      throw new BadRequestException('CONTRACT_ARTIFACT_BYTES_MISSING')
    }
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.artifactService.lockCanonicalArtifact(
      id,
      user._id ?? '',
      isStaff,
      artifact.buffer
    )
  }

  @Post(':id/artifacts/render-lock')
  @Roles('admin', 'staff', 'landlord')
  renderAndLockCanonicalArtifact(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<ContractArtifact> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.artifactService.renderAndLockCanonicalArtifact(
      id,
      user._id ?? '',
      isStaff
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
    isValid: boolean | null
    verificationStatus: 'valid' | 'invalid' | 'not-recorded' | 'unavailable'
    currentHash: string
    storedHash: string | null
    blockchainAddress: string | null
    onChain: unknown
    semanticHash: string | null
    artifactHash: string | null
    layers: {
      offChain: {
        status: 'valid' | 'mismatch' | 'not-recorded' | 'unavailable'
        hash: string | null
        reason?: string | null
      }
      artifact: {
        status: 'valid' | 'mismatch' | 'not-recorded' | 'unavailable'
        hash: string | null
        reason?: string | null
      }
      onChain: {
        status: 'valid' | 'mismatch' | 'not-recorded' | 'unavailable'
        hash: string | null
        reason?: string | null
      }
    }
    signatureIntegrity: 'valid' | 'invalid' | 'not-available'
    amendmentChainIntegrity: 'valid' | 'invalid' | 'not-available'
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

  /** Đồng bộ cấu hình quy trình thuê mới cho hợp đồng nháp */
  @Post(':id/reconcile-flow-profile')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async reconcileFlowProfile(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
    @Body()
    body: {
      flowProfileRef: { profileId: string; version: number; hash: string }
    }
  ): Promise<Contract> {
    if (!body?.flowProfileRef?.profileId || !body?.flowProfileRef?.hash) {
      throw new BadRequestException('flowProfileRef hợp lệ là bắt buộc.')
    }
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.contractsService.reconcileFlowProfile(
      id,
      user._id ?? '',
      isStaff,
      body.flowProfileRef
    )
  }
}
