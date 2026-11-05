import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  ContractChangeRequestDecisionDto,
  CreateContractChangeRequestDto,
} from '../dto/contract-change-request.dto'
import type { ContractChangeRequest } from '../schemas/contract-change-request.schema'
import {
  ContractChangeRequestService,
  type ChangeRequestActor,
  type ChangeRequestListView,
} from '../services/contract-change-request.service'

@ApiTags('contract-change-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contracts/:contractId/change-requests')
export class ContractChangeRequestController {
  constructor(private readonly service: ContractChangeRequestService) {}

  @Get()
  @Roles('admin', 'staff', 'landlord', 'tenant')
  list(
    @Param('contractId') contractId: string,
    @CurrentUser() user: UserPayload
  ): Promise<ChangeRequestListView> {
    return this.service.list(contractId, this.actor(user))
  }

  @Post()
  @Roles('landlord', 'tenant')
  create(
    @Param('contractId') contractId: string,
    @Body() dto: CreateContractChangeRequestDto,
    @CurrentUser() user: UserPayload
  ): Promise<ContractChangeRequest> {
    return this.service.create(contractId, dto, this.actor(user))
  }

  /** Chỉ bên còn lại của hợp đồng được đồng ý; admin và staff không thể đồng ý thay. */
  @Post(':requestId/accept')
  @Roles('landlord', 'tenant')
  accept(
    @Param('contractId') contractId: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: UserPayload
  ): Promise<ContractChangeRequest> {
    return this.service.accept(contractId, requestId, this.actor(user))
  }

  @Post(':requestId/reject')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  reject(
    @Param('contractId') contractId: string,
    @Param('requestId') requestId: string,
    @Body() dto: ContractChangeRequestDecisionDto,
    @CurrentUser() user: UserPayload
  ): Promise<ContractChangeRequest> {
    return this.service.reject(
      contractId,
      requestId,
      dto.reason,
      this.actor(user)
    )
  }

  @Post(':requestId/cancel')
  @Roles('admin', 'staff', 'landlord', 'tenant')
  cancel(
    @Param('contractId') contractId: string,
    @Param('requestId') requestId: string,
    @Body() dto: ContractChangeRequestDecisionDto,
    @CurrentUser() user: UserPayload
  ): Promise<ContractChangeRequest> {
    return this.service.cancel(
      contractId,
      requestId,
      dto.reason,
      this.actor(user)
    )
  }

  private actor(user: UserPayload): ChangeRequestActor {
    const isStaff =
      user.roles?.some(role => role === 'admin' || role === 'staff') ?? false
    return { actorId: user._id ?? '', isStaff }
  }
}
