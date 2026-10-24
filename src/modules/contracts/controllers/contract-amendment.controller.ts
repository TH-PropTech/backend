import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { ContractAmendmentService } from '../services/contract-amendment.service'
import {
  AmendmentActionDto,
  CreateContractAmendmentDto,
  SignContractAmendmentDto,
  UpdateContractAmendmentDto,
} from '../dto/contract-amendment.dto'
import type { ContractAmendment } from '../schemas/contract-amendment.schema'
import type { Response } from 'express'
import { RequirePermission } from '../../rbac/guards/require-permission.decorator'

@ApiTags('contract-amendments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contracts/:contractId/amendments')
export class ContractAmendmentController {
  constructor(private readonly amendmentService: ContractAmendmentService) {}

  @Get()
  @Roles('admin', 'staff', 'landlord', 'tenant')
  list(
    @Param('contractId') contractId: string,
    @CurrentUser() user: UserPayload
  ): Promise<ContractAmendment[]> {
    return this.amendmentService.list(contractId, this.actor(user))
  }

  @Post()
  @RequirePermission('create', 'Contract')
  @Roles('admin', 'staff')
  create(
    @Param('contractId') contractId: string,
    @Body() dto: CreateContractAmendmentDto,
    @CurrentUser() user: UserPayload
  ): Promise<ContractAmendment> {
    return this.amendmentService.create(contractId, dto, this.actor(user))
  }

  @Get(':amendmentId/artifact')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  async downloadArtifact(
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @CurrentUser() user: UserPayload,
    // Ghi byte trực tiếp để ResponseEnvelopeInterceptor không bọc file thành JSON.
    @Res() response: Response
  ): Promise<void> {
    const result = await this.amendmentService.resolveArtifact(
      contractId,
      amendmentId,
      this.actor(user)
    )
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader(
      'X-Contract-Amendment-Artifact-Revision',
      String(result.revision)
    )
    response.setHeader(
      'X-Contract-Amendment-Artifact-Hash',
      result.artifactHash
    )
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="amendment-${amendmentId}-r${result.revision}.pdf"`
    )
    response.setHeader('Content-Length', String(result.bytes.length))
    response.status(200).end(result.bytes)
  }

  @Get(':amendmentId')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  get(
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @CurrentUser() user: UserPayload
  ): Promise<ContractAmendment> {
    return this.amendmentService.get(contractId, amendmentId, this.actor(user))
  }

  @Put(':amendmentId')
  @RequirePermission('update', 'Contract')
  @Roles('admin', 'staff')
  update(
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() dto: UpdateContractAmendmentDto,
    @CurrentUser() user: UserPayload
  ): Promise<ContractAmendment> {
    return this.amendmentService.update(
      contractId,
      amendmentId,
      dto,
      this.actor(user)
    )
  }

  @Post(':amendmentId/lock')
  @RequirePermission('update', 'Contract')
  @Roles('admin', 'staff')
  lock(
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() dto: AmendmentActionDto,
    @CurrentUser() user: UserPayload
  ): Promise<ContractAmendment> {
    return this.amendmentService.lock(
      contractId,
      amendmentId,
      dto.expectedRevision,
      this.actor(user)
    )
  }

  @Post(':amendmentId/artifact')
  @RequirePermission('update', 'Contract')
  @Roles('admin', 'staff')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('artifact'))
  lockArtifact(
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() dto: AmendmentActionDto,
    @CurrentUser() user: UserPayload,
    @UploadedFile() artifact?: Express.Multer.File
  ): Promise<ContractAmendment> {
    if (!artifact?.buffer) {
      throw new BadRequestException('CONTRACT_ARTIFACT_BYTES_MISSING')
    }
    return this.amendmentService.lockArtifact(
      contractId,
      amendmentId,
      dto.expectedRevision,
      artifact.buffer,
      this.actor(user)
    )
  }

  @Post(':amendmentId/sign')
  @Roles('landlord', 'tenant')
  async sign(
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() dto: SignContractAmendmentDto,
    @CurrentUser() user: UserPayload
  ): Promise<ContractAmendment> {
    const role = await this.amendmentService.resolveParticipantRole(
      contractId,
      user._id ?? ''
    )
    return this.amendmentService.sign(
      contractId,
      amendmentId,
      dto.expectedRevision,
      dto.signatureHash,
      { actorId: user._id ?? '', isStaff: false, ...(role ? { role } : {}) }
    )
  }

  @Post(':amendmentId/reject')
  @Roles('landlord', 'tenant', 'admin', 'staff')
  reject(
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() dto: AmendmentActionDto,
    @CurrentUser() user: UserPayload
  ): Promise<ContractAmendment> {
    return this.amendmentService.reject(
      contractId,
      amendmentId,
      dto.expectedRevision,
      this.actor(user)
    )
  }

  @Post(':amendmentId/cancel')
  @RequirePermission('update', 'Contract')
  @Roles('admin', 'staff')
  cancel(
    @Param('contractId') contractId: string,
    @Param('amendmentId') amendmentId: string,
    @Body() dto: AmendmentActionDto,
    @CurrentUser() user: UserPayload
  ): Promise<ContractAmendment> {
    return this.amendmentService.cancel(
      contractId,
      amendmentId,
      dto.expectedRevision,
      this.actor(user)
    )
  }

  private actor(user: UserPayload): {
    actorId: string
    isStaff: boolean
    role?: 'tenant' | 'landlord'
  } {
    const isStaff =
      user.roles?.some(role => role === 'admin' || role === 'staff') ?? false
    const role = user.roles?.includes('tenant')
      ? 'tenant'
      : user.roles?.includes('landlord')
        ? 'landlord'
        : undefined
    return { actorId: user._id ?? '', isStaff, ...(role ? { role } : {}) }
  }
}
