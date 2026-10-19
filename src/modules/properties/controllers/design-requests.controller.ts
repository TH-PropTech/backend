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
  DesignRequestOptionalNoteDto,
  DesignRequestQueueQueryDto,
  MyDesignRequestsQueryDto,
} from '../dto/design-request.dto'
import {
  DesignRequestsService,
  type DesignRequestActor,
  type DesignRequestDetail,
  type DesignRequestListResult,
} from '../services/design-requests.service'

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

/** Yêu cầu thiết kế / chỉnh sửa 3D: chủ nhà gửi, staff phân loại, admin thiết kế & bàn giao. */
@ApiTags('design-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('design-requests')
export class DesignRequestsController {
  constructor(private readonly service: DesignRequestsService) {}

  @Post()
  @Roles('landlord')
  @ApiOperation({ summary: 'Chủ nhà gửi yêu cầu thiết kế 3D' })
  create(
    @Body() dto: CreateDesignRequestDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.create(landlordOf(user), dto)
  }

  @Get('my')
  @Roles('landlord')
  @ApiOperation({ summary: 'Yêu cầu của tôi' })
  listMine(
    @Query() query: MyDesignRequestsQueryDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestListResult> {
    return this.service.listMine(landlordOf(user).id, query)
  }

  @Get('queue')
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Hàng đợi yêu cầu (cũ nhất trước)' })
  queue(
    @Query() query: DesignRequestQueueQueryDto
  ): Promise<DesignRequestListResult> {
    return this.service.queue(query)
  }

  @Get(':id')
  @Roles('landlord', 'staff', 'admin')
  @ApiOperation({ summary: 'Chi tiết yêu cầu kèm lịch sử' })
  getOne(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.getById(id, actorOf(user))
  }

  @Post(':id/reply')
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
  @HttpCode(HttpStatus.OK)
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Staff/admin hỏi thêm thông tin' })
  requestInfo(
    @Param('id') id: string,
    @Body() dto: DesignRequestNoteDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.requestInfo(id, actorOf(user), dto)
  }

  @Post(':id/escalate')
  @HttpCode(HttpStatus.OK)
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Chuyển yêu cầu cho quản trị viên' })
  escalate(
    @Param('id') id: string,
    @Body() dto: DesignRequestOptionalNoteDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.escalate(id, actorOf(user), dto)
  }

  @Post(':id/reject')
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
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin bắt đầu thiết kế' })
  start(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.start(id, actorOf(user))
  }

  @Post(':id/deliver')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin bàn giao thiết kế cho chủ nhà duyệt' })
  deliver(
    @Param('id') id: string,
    @Body() dto: DeliverDesignRequestDto,
    @CurrentUser() user: UserPayload
  ): Promise<DesignRequestDetail> {
    return this.service.deliver(id, actorOf(user), dto)
  }
}
