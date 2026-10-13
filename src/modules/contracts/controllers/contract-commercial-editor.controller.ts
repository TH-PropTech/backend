import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  ContractCommercialEditorResponseDto,
  ContractCommercialValidationDto,
  SaveContractCommercialDraftDto,
  ValidateContractCommercialDraftDto,
} from '../dto/contract-commercial-editor.dto'
import { ContractCommercialEditorService } from '../services/contract-commercial-editor.service'

@ApiTags('contracts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contracts')
export class ContractCommercialEditorController {
  constructor(
    private readonly editorService: ContractCommercialEditorService
  ) {}

  @Get(':id/admin-editor')
  @Roles('admin')
  getEditor(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<ContractCommercialEditorResponseDto> {
    return this.editorService.getEditor(id, user._id ?? '', true)
  }

  @Post(':id/commercial-draft/validate')
  @Roles('admin')
  validate(
    @Param('id') id: string,
    @Body() dto: ValidateContractCommercialDraftDto,
    @CurrentUser('id') actorId: string
  ): Promise<ContractCommercialValidationDto> {
    return this.editorService.validateDraft(id, dto.commercial, actorId, true)
  }

  @Put(':id/commercial-draft')
  @Roles('admin')
  save(
    @Param('id') id: string,
    @Body() dto: SaveContractCommercialDraftDto,
    @CurrentUser('id') actorId: string
  ): Promise<ContractCommercialEditorResponseDto> {
    return this.editorService.saveDraft(
      id,
      dto.commercial,
      dto.expectedRevision,
      actorId,
      true
    )
  }
}
