import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiHeader,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../auth/interfaces/auth.interface'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import {
  ApplyOwnershipTransferDto,
  PreviewOwnershipTransferDto,
} from './dto/ownership-transfer.dto'
import {
  OwnershipTransferService,
  type OwnershipTransferPreviewResponse,
  type OwnershipTransferSummaryResponse,
} from './ownership-transfer.service'

interface AuthenticatedRequest {
  user?: UserPayload
}

@ApiTags('ownership-transfers')
@ApiBearerAuth()
@Controller('ownership-transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class OwnershipTransferController {
  public constructor(
    private readonly ownershipTransferService: OwnershipTransferService
  ) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview a complete apartment ownership transfer' })
  @ApiBody({ type: PreviewOwnershipTransferDto })
  @ApiOkResponse({ description: 'Redacted transfer preview' })
  @ApiBadRequestResponse({ description: 'Invalid target email' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Target landlord not found' })
  @ApiConflictResponse({ description: 'Target account is incompatible' })
  public preview(
    @Body() dto: PreviewOwnershipTransferDto,
    @Request() request: AuthenticatedRequest
  ): Promise<OwnershipTransferPreviewResponse> {
    const adminId = request.user?._id
    if (!adminId) throw new Error('Authenticated admin id is missing')
    return this.ownershipTransferService.preview(dto.targetEmail, adminId)
  }

  @Post(':transferId/apply')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Apply a validated ownership transfer preview' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Stable key used to safely retry the same apply request',
  })
  @ApiBody({ type: ApplyOwnershipTransferDto })
  @ApiCreatedResponse({ description: 'Ownership transfer completed' })
  @ApiBadRequestResponse({ description: 'Invalid preview or idempotency key' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Transfer preview not found' })
  @ApiConflictResponse({ description: 'Stale or conflicting preview' })
  @ApiUnprocessableEntityResponse({
    description: 'MongoDB transactions unavailable',
  })
  public apply(
    @Param('transferId') transferId: string,
    @Body() dto: ApplyOwnershipTransferDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined
  ): Promise<OwnershipTransferSummaryResponse> {
    return this.ownershipTransferService.apply(transferId, dto, idempotencyKey)
  }

  @Get(':transferId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read a redacted ownership transfer report' })
  @ApiOkResponse({ description: 'Redacted transfer summary' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Transfer preview not found' })
  public getSummary(
    @Param('transferId') transferId: string
  ): Promise<OwnershipTransferSummaryResponse> {
    return this.ownershipTransferService.getSummary(transferId)
  }
}
