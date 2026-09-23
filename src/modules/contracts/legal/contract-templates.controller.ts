import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import {
  ContractTemplateGovernanceService,
  type ContractTemplateDraftInput,
} from './contract-template-governance.service'
import type {
  ContractTemplateAddendum,
  ContractTemplateClause,
  ContractTemplate,
} from './contract-template.schema'
import type { ContractTemplateAudit } from './contract-template-audit.schema'
import type { ContractTemplateValidation } from './contract-template-governance.service'

export class SaveContractTemplateDraftDto implements ContractTemplateDraftInput {
  @IsIn(['PRIVATE_CIVIL_APARTMENT_LEASE', 'REAL_ESTATE_BUSINESS_STANDARD'])
  legalProfile!: ContractTemplateDraftInput['legalProfile']

  @IsArray()
  @IsObject({ each: true })
  clauses!: ContractTemplateClause[]

  @IsArray()
  @IsString({ each: true })
  allowedVariables!: string[]

  @IsArray()
  @IsObject({ each: true })
  addenda!: ContractTemplateAddendum[]

  @IsArray()
  @IsString({ each: true })
  citationIds!: string[]

  @IsInt()
  @Min(0)
  expectedRevision!: number
}

export class PublishContractTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string
}

@ApiTags('contract-templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contract-templates')
export class ContractTemplatesController {
  constructor(
    private readonly governanceService: ContractTemplateGovernanceService
  ) {}

  @Get(':templateKey')
  @Roles('admin', 'staff')
  getPublished(
    @Param('templateKey') templateKey: string
  ): Promise<ContractTemplateDraftInput> {
    return this.governanceService.getPublishedVersion(templateKey)
  }

  @Get(':templateKey/versions/:version')
  @Roles('admin', 'staff')
  getPublishedVersion(
    @Param('templateKey') templateKey: string,
    @Param('version', ParseIntPipe) version: number
  ): Promise<ContractTemplateDraftInput> {
    return this.governanceService.getPublishedVersion(templateKey, version)
  }

  @Get(':templateKey/audits')
  @Roles('admin', 'staff')
  getAuditHistory(
    @Param('templateKey') templateKey: string
  ): Promise<ContractTemplateAudit[]> {
    return this.governanceService.getAuditHistory(templateKey)
  }

  @Post('admin/:templateKey/draft')
  @Roles('admin')
  saveDraft(
    @Param('templateKey') templateKey: string,
    @Body() dto: SaveContractTemplateDraftDto,
    @CurrentUser('id') actorId: string
  ): Promise<ContractTemplate> {
    return this.governanceService.saveDraft(
      templateKey,
      dto,
      actorId,
      dto.expectedRevision
    )
  }

  @Post('admin/:templateKey/validate')
  @Roles('admin')
  validateDraft(
    @Param('templateKey') templateKey: string
  ): Promise<ContractTemplateValidation> {
    return this.governanceService.validateDraft(templateKey)
  }

  @Post('admin/:templateKey/publish')
  @Roles('admin')
  publishDraft(
    @Param('templateKey') templateKey: string,
    @Body() dto: PublishContractTemplateDto,
    @CurrentUser('id') actorId: string
  ): Promise<ContractTemplate> {
    return this.governanceService.publishDraft(templateKey, actorId, dto.reason)
  }
}
