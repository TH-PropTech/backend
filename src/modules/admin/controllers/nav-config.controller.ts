import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { UpdateNavConfigDto } from '../dto/update-nav-config.dto'
import {
  NavConfigService,
  type NavConfigView,
} from '../services/nav-config.service'

/** Menu bảng điều khiển: nhân viên đọc để biết mục nào được hiện, chỉ admin được đổi. */
@ApiTags('admin-nav')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/nav-config')
export class NavConfigController {
  constructor(private readonly service: NavConfigService) {}

  @Get()
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Các mục menu bị ẩn với nhân viên' })
  get(): Promise<NavConfigView> {
    return this.service.get()
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin bật/tắt hiển thị mục menu cho nhân viên' })
  update(
    @Body() dto: UpdateNavConfigDto,
    @CurrentUser('email') adminEmail: string
  ): Promise<NavConfigView> {
    return this.service.update(dto.hiddenForStaff, adminEmail ?? 'admin')
  }
}
