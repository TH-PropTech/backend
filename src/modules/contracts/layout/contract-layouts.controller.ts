import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type {
  ContractLayoutBlock,
  ContractLayoutDisclosure,
  ContractLayoutSupplementaryClause,
} from '../schemas/contract-layout-profile.schema'
import {
  ContractLayoutService,
  type ContractLayoutDraftInput,
  type ContractLayoutValidation,
} from './contract-layout.service'
import type { ContractLayoutProfile } from '../schemas/contract-layout-profile.schema'

export class SaveContractLayoutDraftDto implements ContractLayoutDraftInput {
  @IsIn(['PRIVATE_CIVIL_APARTMENT_LEASE', 'REAL_ESTATE_BUSINESS_STANDARD'])
  legalProfile!: ContractLayoutDraftInput['legalProfile']

  @IsOptional()
  @IsString()
  templateKey?: string | null

  @IsArray()
  blocks!: ContractLayoutBlock[]

  @IsArray()
  supplementaryClauses!: ContractLayoutSupplementaryClause[]

  @IsOptional()
  @IsArray()
  disclosures?: ContractLayoutDisclosure[]

  @IsInt()
  @Min(0)
  expectedRevision!: number
}

export class LayoutReasonDto {
  @IsOptional()
  @IsString()
  reason?: string
}

export class ArchiveContractLayoutDto {
  @IsInt()
  @Min(1)
  version!: number

  @IsString()
  reason!: string
}

@ApiTags('contract-layouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contract-layouts')
export class ContractLayoutsController {
  constructor(private readonly layoutService: ContractLayoutService) {}

  @Post('admin/:profileKey/draft')
  @Roles('admin')
  saveDraft(
    @Param('profileKey') profileKey: string,
    @Body() dto: SaveContractLayoutDraftDto,
    @CurrentUser('id') actorId: string
  ): Promise<ContractLayoutProfile> {
    return this.layoutService.saveDraft(
      profileKey,
      dto,
      actorId,
      dto.expectedRevision
    )
  }

  @Post('admin/:profileKey/validate')
  @Roles('admin')
  validateDraft(
    @Param('profileKey') profileKey: string
  ): Promise<ContractLayoutValidation> {
    return this.layoutService.validateDraft(profileKey)
  }

  @Post('admin/:profileKey/preview')
  @Roles('admin', 'staff')
  previewDraft(
    @Param('profileKey') profileKey: string
  ): Promise<ContractLayoutProfile> {
    return this.layoutService.previewDraft(profileKey)
  }

  @Post('admin/:profileKey/publish')
  @Roles('admin')
  publishDraft(
    @Param('profileKey') profileKey: string,
    @Body() dto: LayoutReasonDto,
    @CurrentUser('id') actorId: string
  ): Promise<ContractLayoutProfile> {
    return this.layoutService.publishDraft(profileKey, actorId, dto.reason)
  }

  @Post('admin/:profileKey/archive')
  @Roles('admin')
  archive(
    @Param('profileKey') profileKey: string,
    @Body() dto: ArchiveContractLayoutDto,
    @CurrentUser('id') actorId: string
  ): Promise<ContractLayoutProfile> {
    return this.layoutService.archive(
      profileKey,
      dto.version,
      actorId,
      dto.reason
    )
  }
}
