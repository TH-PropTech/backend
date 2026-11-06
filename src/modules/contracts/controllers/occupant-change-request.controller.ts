import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  CreateOccupantRequestDto,
  OccupantRequestCounterResponseDto,
  OccupantRequestDecisionDto,
} from '../dto/occupant-change-request.dto'
import type { OccupantChangeRequest } from '../schemas/occupant-change-request.schema'
import {
  OccupantChangeRequestService,
  type OccupantRequestActor,
  type OccupantRequestListView,
} from '../services/occupant-change-request.service'

@ApiTags('occupant-change-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contracts/:contractId/occupant-requests')
export class OccupantChangeRequestController {
  constructor(private readonly service: OccupantChangeRequestService) {}

  @Get()
  @Roles('admin', 'staff', 'landlord', 'tenant')
  list(
    @Param('contractId') contractId: string,
    @CurrentUser() user: UserPayload
  ): Promise<OccupantRequestListView> {
    return this.service.list(contractId, this.actor(user))
  }

  @Post()
  @Roles('tenant')
  create(
    @Param('contractId') contractId: string,
    @Body() dto: CreateOccupantRequestDto,
    @CurrentUser() user: UserPayload
  ): Promise<OccupantChangeRequest> {
    return this.service.create(contractId, dto, this.actor(user))
  }

  @Post(':requestId/decision')
  @Roles('landlord')
  decide(
    @Param('contractId') contractId: string,
    @Param('requestId') requestId: string,
    @Body() dto: OccupantRequestDecisionDto,
    @CurrentUser() user: UserPayload
  ): Promise<OccupantChangeRequest> {
    return this.service.decide(contractId, requestId, dto, this.actor(user))
  }

  @Post(':requestId/counter-response')
  @Roles('tenant')
  respondToCounter(
    @Param('contractId') contractId: string,
    @Param('requestId') requestId: string,
    @Body() dto: OccupantRequestCounterResponseDto,
    @CurrentUser() user: UserPayload
  ): Promise<OccupantChangeRequest> {
    return this.service.respondToCounter(
      contractId,
      requestId,
      dto.accept,
      this.actor(user)
    )
  }

  private actor(user: UserPayload): OccupantRequestActor {
    return {
      actorId: user._id ?? '',
      isStaff:
        user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false,
    }
  }
}
