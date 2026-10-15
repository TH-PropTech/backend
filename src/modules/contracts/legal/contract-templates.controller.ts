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
  type ContractTemplateLegalReleaseInput,
} from './contract-template-governance.service'
import type { ContractTemplateAddendum } from '../schemas/contract-template.schema'
import type { ContractTemplateAuditView } from './contract-template-audit.mapper'
import type { ContractTemplateValidation } from './contract-template-governance.service'
import {
  toContractTemplateResponse,
  type ContractTemplateResponse,
} from './contract-template-response.mapper'

export class SaveContractTemplateDraftDto {
  @IsIn(['PRIVATE_CIVIL_APARTMENT_LEASE', 'REAL_ESTATE_BUSINESS_STANDARD'])
  legalProfile!: ContractTemplateDraftInput['legalProfile']

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  clauses?: ContractTemplateDraftInput['clauses']

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

export class PublishLegalReleaseDto implements ContractTemplateLegalReleaseInput {
  @IsIn(['PRIVATE_CIVIL_APARTMENT_LEASE', 'REAL_ESTATE_BUSINESS_STANDARD'])
  legalProfile!: ContractTemplateLegalReleaseInput['legalProfile']

  @IsArray()
  @IsObject({ each: true })
  clauses!: NonNullable<ContractTemplateLegalReleaseInput['clauses']>

  @IsArray()
  @IsString({ each: true })
  allowedVariables!: string[]

  @IsArray()
  @IsObject({ each: true })
  addenda!: ContractTemplateAddendum[]

  @IsArray()
  @IsString({ each: true })
  citationIds!: string[]

  @IsArray()
  @IsObject({ each: true })
  annexDefinitions!: NonNullable<
    ContractTemplateLegalReleaseInput['annexDefinitions']
  >

  @IsInt()
  @Min(2)
  schemaVersion!: number

  @IsOptional()
  @IsString()
  effectiveFrom?: string

  @IsOptional()
  referenceOnly!: boolean

  @IsString()
  @IsNotEmpty()
  reviewReference!: string
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
  ): Promise<ContractTemplateResponse> {
    return this.governanceService
      .getPublishedVersion(templateKey)
      .then(toContractTemplateResponse)
  }

  @Get(':templateKey/versions/:version')
  @Roles('admin', 'staff')
  getPublishedVersion(
    @Param('templateKey') templateKey: string,
    @Param('version', ParseIntPipe) version: number
  ): Promise<ContractTemplateResponse> {
    return this.governanceService
      .getPublishedVersion(templateKey, version)
      .then(toContractTemplateResponse)
  }

  @Get(':templateKey/audits')
  @Roles('admin', 'staff')
  getAuditHistory(
    @Param('templateKey') templateKey: string
  ): Promise<ContractTemplateAuditView[]> {
    return this.governanceService.getAuditHistory(templateKey)
  }

  @Post('admin/:templateKey/draft')
  @Roles('admin')
  saveDraft(
    @Param('templateKey') templateKey: string,
    @Body() dto: SaveContractTemplateDraftDto,
    @CurrentUser('id') actorId: string
  ): Promise<ContractTemplateResponse> {
    return this.governanceService
      .saveDraft(
        templateKey,
        {
          legalProfile: dto.legalProfile,
          clauses: dto.clauses ?? [],
          allowedVariables: dto.allowedVariables,
          addenda: dto.addenda,
          citationIds: dto.citationIds,
          expectedRevision: dto.expectedRevision,
        },
        actorId,
        dto.expectedRevision
      )
      .then(toContractTemplateResponse)
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
  ): Promise<ContractTemplateResponse> {
    return this.governanceService
      .publishDraft(templateKey, actorId, dto.reason)
      .then(toContractTemplateResponse)
  }

  @Post('legal-release/:templateKey')
  @Roles('admin')
  publishLegalRelease(
    @Param('templateKey') templateKey: string,
    @Body() dto: PublishLegalReleaseDto,
    @CurrentUser('id') actorId: string
  ): Promise<ContractTemplateResponse> {
    return this.governanceService
      .publishLegalRelease(templateKey, dto, actorId, dto.reviewReference)
      .then(toContractTemplateResponse)
  }
}
