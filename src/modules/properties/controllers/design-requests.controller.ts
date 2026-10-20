import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  CreateDesignRequestDto,
  DeliverDesignRequestDto,
  DesignRequestNoteDto,
  DesignRequestQueueQueryDto,
  MyDesignRequestsQueryDto,
} from '../dto/design-request.dto'
import {
  DesignRequestsService,
  type DesignRequestActor,
  type DesignRequestDetail,
  type DesignRequestListResult,
} from '../services/design-requests.service'
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator'

function actorOf(user: UserPayload): DesignRequestActor {
  if (!user._id) throw new UnauthorizedException()
  const roles = (user.roles ?? []).map(r => r.toLowerCase())
  const role = roles.includes('admin')
    ? 'admin'
    : roles.includes('staff')
      ? 'staff'
      : 'landlord'
  return { id: user._id, role }
}

/** Landlord actions: always acts as the owner, whatever extra roles the token carries. */
function landlordOf(user: UserPayload): DesignRequestActor {
  if (!user._id) throw new UnauthorizedException()
  return { id: user._id, role: 'landlord' }
}

/** Yêu cầu thiết kế / chỉnh sửa 3D: chủ nhà gửi, nhân viên nhận, thiết kế & bàn giao, chủ nhà duyệt. */
@ApiTags('design-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('design-requests')
export class DesignRequestsController {
  constructor(private readonly service: DesignRequestsService) {}

  @Post()
  @RequirePermission('create', 'DesignRequest')
  @Roles('landlord')
  @ApiOperation({ summary: 'Chủ nhà gửi yêu cầu thiết kế 3D' })
  create(
    @Body() dto: CreateDesignRequestDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.create(landlordOf(user), dto)
  }

  @Get('my')
  @RequirePermission('read', 'DesignRequest')
  @Roles('landlord')
  @ApiOperation({ summary: 'Yêu cầu của tôi' })
  listMine(
    @Query() query: MyDesignRequestsQueryDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestListResult> {
    return this.service.listMine(landlordOf(user).id, query)
  }

  @Get('queue')
  @RequirePermission('read', 'DesignRequest')
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Hàng đợi yêu cầu (cũ nhất trước)' })
  queue(
    @Query() query: DesignRequestQueueQueryDto
  ): Promise<DesignRequestListResult> {
    return this.service.queue(query)
  }

  @Get(':id')
  @RequirePermission('read', 'DesignRequest')
  @Roles('landlord', 'staff', 'admin')
  @ApiOperation({ summary: 'Chi tiết yêu cầu kèm lịch sử' })
  getOne(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.getById(id, actorOf(user))
  }

  @Post(':id/reply')
  @RequirePermission('update', 'DesignRequest')
  @HttpCode(HttpStatus.OK)
  @Roles('landlord')
  @ApiOperation({ summary: 'Chủ nhà bổ sung thông tin' })
  reply(
    @Param('id') id: string,
    @Body() dto: DesignRequestNoteDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.reply(id, landlordOf(user), dto)
  }

  @Post(':id/approve')
  @RequirePermission('approve', 'DesignRequest')
  @HttpCode(HttpStatus.OK)
  @Roles('landlord')
  @ApiOperation({ summary: 'Chủ nhà duyệt thiết kế' })
  approve(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.approve(id, landlordOf(user))
  }

  @Post(':id/feedback')
  @RequirePermission('update', 'DesignRequest')
  @HttpCode(HttpStatus.OK)
  @Roles('landlord')
  @ApiOperation({ summary: 'Chủ nhà gửi phản hồi, yêu cầu chỉnh sửa' })
  feedback(
    @Param('id') id: string,
    @Body() dto: DesignRequestNoteDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.feedback(id, landlordOf(user), dto)
  }

  @Post(':id/cancel')
  @RequirePermission('update', 'DesignRequest')
  @HttpCode(HttpStatus.OK)
  @Roles('landlord')
  @ApiOperation({ summary: 'Chủ nhà huỷ yêu cầu' })
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.cancel(id, landlordOf(user))
  }

  @Post(':id/request-info')
  @RequirePermission('update', 'DesignRequest')
  @HttpCode(HttpStatus.OK)
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Nhân viên hỏi thêm thông tin' })
  requestInfo(
    @Param('id') id: string,
    @Body() dto: DesignRequestNoteDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.requestInfo(id, actorOf(user), dto)
  }

  @Post(':id/reject')
  @RequirePermission('update', 'DesignRequest')
  @HttpCode(HttpStatus.OK)
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Từ chối yêu cầu' })
  reject(
    @Param('id') id: string,
    @Body() dto: DesignRequestNoteDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.reject(id, actorOf(user), dto)
  }

  @Post(':id/start')
  @RequirePermission('update', 'DesignRequest')
  @HttpCode(HttpStatus.OK)
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Nhân viên nhận và bắt đầu thiết kế' })
  start(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.start(id, actorOf(user))
  }

  @Post(':id/deliver')
  @RequirePermission('update', 'DesignRequest')
  @HttpCode(HttpStatus.OK)
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Nhân viên bàn giao thiết kế cho chủ nhà duyệt' })
  deliver(
    @Param('id') id: string,
    @Body() dto: DeliverDesignRequestDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.deliver(id, actorOf(user), dto)
  }
}
