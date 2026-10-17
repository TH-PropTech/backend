import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { Public } from '../../../common/decorators/public.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import {
  CreateApartmentDesignDto,
  UpdateApartmentDesignDto,
} from '../dto/apartment-design.dto'
import {
  ApartmentDesignsService,
  type AdminApartmentDesign,
  type PublicApartmentDesign,
} from '../services/apartment-designs.service'

/** Thiết kế 3D của căn hộ: người xem đọc danh sách đang bật; admin/staff tạo, sửa, ẩn/hiện, xoá. */
@ApiTags('apartment-designs')
@Controller('apartments')
export class ApartmentDesignsController {
  constructor(private readonly designs: ApartmentDesignsService) {}

  @Public()
  @Get(':id/designs')
  @ApiOperation({ summary: 'Thiết kế 3D đang hiện của căn hộ' })
  async listVisible(@Param('id') id: string): Promise<PublicApartmentDesign[]> {
    return this.designs.listVisible(id)
  }

  @Get(':id/designs/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Admin: toàn bộ thiết kế 3D (kể cả đang ẩn)' })
  async listAll(@Param('id') id: string): Promise<AdminApartmentDesign[]> {
    return this.designs.listAll(id)
  }

  @Post(':id/designs/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Admin: thêm thiết kế 3D' })
  async create(
    @Param('id') id: string,
    @Body() dto: CreateApartmentDesignDto,
    @CurrentUser('id') actorId: string
  ): Promise<AdminApartmentDesign> {
    return this.designs.create(id, dto, actorId)
  }

  @Patch(':id/designs/admin/:designId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Admin: sửa / ẩn / hiện thiết kế 3D' })
  async update(
    @Param('id') id: string,
    @Param('designId') designId: string,
    @Body() dto: UpdateApartmentDesignDto
  ): Promise<AdminApartmentDesign> {
    return this.designs.update(id, designId, dto)
  }

  @Delete(':id/designs/admin/:designId')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'Admin: xoá thiết kế 3D' })
  async remove(
    @Param('id') id: string,
    @Param('designId') designId: string
  ): Promise<void> {
    await this.designs.remove(id, designId)
  }
}
