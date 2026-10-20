import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CreateRentalApplicationDto } from '../dto/create-rental-application.dto'
import type { RentalApplicationContext } from '../dto/rental-application-context.dto'
import { RentalApplicationQueryDto } from '../dto/rental-application-query.dto'
import { RespondRentalApplicationDto } from '../dto/respond-rental-application.dto'
import { RentalApplication } from '../schemas/rental-application.schema'
import {
  RentalApplicationListResult,
  RentalApplicationsService,
} from '../services/rental-applications.service'
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator'

@ApiTags('rental-applications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rental-applications')
export class RentalApplicationsController {
  constructor(private readonly service: RentalApplicationsService) {}

  /** GET /api/v1/rental-applications/context/:apartmentId — Tenant review context */
  @Get('context/:apartmentId')
  @Roles('tenant')
  @ApiOkResponse()
  context(
    @Param('apartmentId') apartmentId: string,
    @CurrentUser('id') tenantId: string
  ): Promise<RentalApplicationContext> {
    return this.service.getContext(tenantId, apartmentId)
  }

  /** POST /api/v1/rental-applications — Tenant submits an application [uc_customer_contract] */
  @Post()
  @RequirePermission('create', 'RentalApplication')
  @Roles('tenant')
  @ApiOperation({ summary: 'Submit a pre-contract rental application' })
  @ApiCreatedResponse({ type: RentalApplication })
  create(
    @CurrentUser('id') tenantId: string,
    @Body() dto: CreateRentalApplicationDto
  ): Promise<RentalApplication> {
    return this.service.create(tenantId, dto)
  }

  /** GET /api/v1/rental-applications/mine — Tenant applications [uc_customer_contract] */
  @Get('mine')
  @RequirePermission('read', 'RentalApplication')
  @Roles('tenant')
  @ApiOkResponse()
  mine(
    @CurrentUser('id') tenantId: string,
    @Query() query: RentalApplicationQueryDto
  ): Promise<RentalApplicationListResult> {
    return this.service.getMine(tenantId, query)
  }

  /** GET /api/v1/rental-applications/received — Landlord applications [uc_staff_contract] */
  @Get('received')
  @RequirePermission('read', 'RentalApplication')
  @Roles('landlord')
  @ApiOkResponse()
  received(
    @CurrentUser('id') landlordId: string,
    @Query() query: RentalApplicationQueryDto
  ): Promise<RentalApplicationListResult> {
    return this.service.getReceived(landlordId, query)
  }

  @Get(':id')
  @Roles('tenant', 'landlord', 'staff', 'admin')
  @ApiOkResponse({ type: RentalApplication })
  getOne(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser() user: { roles?: string[] }
  ): Promise<RentalApplication> {
    const isStaff =
      user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
    return this.service.getOne(id, actorId, isStaff)
  }

  @Post(':id/retry-provisioning')
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Retry failed accepted-application provisioning' })
  @ApiOkResponse({ type: RentalApplication })
  retryProvisioning(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string
  ): Promise<RentalApplication> {
    return this.service.retryProvisioning(id, actorId)
  }

  /** PATCH /api/v1/rental-applications/:id/respond — Landlord decision [uc_staff_contract] */
  @Patch(':id/respond')
  @RequirePermission('approve', 'RentalApplication')
  @Roles('landlord')
  @ApiOkResponse({ type: RentalApplication })
  respond(
    @Param('id') id: string,
    @CurrentUser('id') landlordId: string,
    @Body() dto: RespondRentalApplicationDto
  ): Promise<RentalApplication> {
    return this.service.respond(id, landlordId, dto)
  }
}
