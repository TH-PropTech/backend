import {
  Controller,
  Get,
  Put,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { PoliciesService } from '../services/policies.service'
import { Policy } from '../schemas/policy.schema'
import {
  UpdatePolicyDto,
  UpdatePolicyStatusDto,
  PublicPolicyItem,
} from '../dto/update-policy.dto'
import { Public } from '../../../common/decorators/public.decorator'

@ApiTags('policies')
@Controller('policies')
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  /**
   * Public: Lấy danh sách các chính sách công khai có hiệu lực cho trang /terms
   */
  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Lấy danh sách chính sách công khai có hiệu lực' })
  async getPublicPolicies(): Promise<PublicPolicyItem[]> {
    return this.policiesService.findPublicPolicies()
  }

  /**
   * Admin: Lấy toàn bộ danh sách chính sách phục vụ quản trị
   */
  @Get('admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin lấy toàn bộ danh sách chính sách' })
  async getAdminPolicies(): Promise<Policy[]> {
    return this.policiesService.findAdminPolicies()
  }

  /**
   * Public fallback: Tương thích với các client cũ
   */
  @Public()
  @Get()
  async getAllPolicies(): Promise<PublicPolicyItem[]> {
    return this.policiesService.findPublicPolicies()
  }

  /**
   * Public: Chi tiết một chính sách
   */
  @Public()
  @Get(':key')
  async getPolicyByKey(@Param('key') key: string): Promise<Policy> {
    return this.policiesService.findOne(key)
  }

  /**
   * Admin: Cập nhật giá trị chính sách có kiểm tra validation và lưu audit actor
   */
  @Patch(':key')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin cập nhật giá trị chính sách' })
  async updatePolicy(
    @Param('key') key: string,
    @Body() dto: UpdatePolicyDto,
    @CurrentUser() user: UserPayload
  ): Promise<Policy> {
    const actorId = user._id ?? 'admin'
    return this.policiesService.update(key, dto.value, actorId)
  }

  /**
   * Admin: Bật / tắt trạng thái hoạt động của chính sách
   */
  @Patch(':key/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin bật tắt trạng thái chính sách' })
  async updatePolicyStatus(
    @Param('key') key: string,
    @Body() dto: UpdatePolicyStatusDto,
    @CurrentUser() user: UserPayload
  ): Promise<Policy> {
    const actorId = user._id ?? 'admin'
    return this.policiesService.updateStatus(key, dto.status, actorId)
  }

  /**
   * Legacy PUT support for admin
   */
  @Put(':key')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async legacyPutPolicy(
    @Param('key') key: string,
    @Body() dto: UpdatePolicyDto,
    @CurrentUser() user: UserPayload
  ): Promise<Policy> {
    const actorId = user._id ?? 'admin'
    return this.policiesService.update(key, dto.value, actorId)
  }
}
