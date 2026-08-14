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
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { RolesGuard } from '../../common/guards/roles.guard'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CreateRentalApplicationDto } from './dto/create-rental-application.dto'
import { RentalApplicationQueryDto } from './dto/rental-application-query.dto'
import { RespondRentalApplicationDto } from './dto/respond-rental-application.dto'
import { RentalApplication } from './schemas/rental-application.schema'
import {
  RentalApplicationListResult,
  RentalApplicationsService,
} from './rental-applications.service'

@ApiTags('rental-applications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rental-applications')
export class RentalApplicationsController {
  constructor(private readonly service: RentalApplicationsService) {}

  /** POST /api/v1/rental-applications — Tenant submits an application [uc_customer_contract] */
  @Post()
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
  @Roles('landlord')
  @ApiOkResponse()
  received(
    @CurrentUser('id') landlordId: string,
    @Query() query: RentalApplicationQueryDto
  ): Promise<RentalApplicationListResult> {
    return this.service.getReceived(landlordId, query)
  }

  /** PATCH /api/v1/rental-applications/:id/respond — Landlord decision [uc_staff_contract] */
  @Patch(':id/respond')
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
