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
import type { CheckResult } from '../../ai/utils/groq-probe'
import {
  AddGroqKeysDto,
  CheckGroqKeyDto,
  PatchGroqKeyDto,
} from '../../ai/dto/groq-keys.dto'
import { GroqKeysService } from '../../ai/services/groq-keys.service'
import type {
  AddGroqKeysResult,
  GroqKeyItem,
} from '../../ai/utils/groq-keys.types'

@ApiTags('groq-keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('groq-keys')
export class GroqKeysController {
  constructor(private readonly service: GroqKeysService) {}

  @Get('admin')
  @ApiOperation({ summary: 'Admin: danh sách Groq API key (đã mask)' })
  async list(): Promise<GroqKeyItem[]> {
    return this.service.list()
  }

  @Post('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: thêm nhiều Groq API key' })
  async add(@Body() dto: AddGroqKeysDto): Promise<AddGroqKeysResult> {
    const checks: Record<string, CheckResult> = dto.checks ?? {}
    return this.service.addMany(dto.keys, checks)
  }

  @Post('admin/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: kiểm tra một key (thô hoặc đã lưu)' })
  async check(@Body() dto: CheckGroqKeyDto): Promise<CheckResult> {
    return this.service.check({
      ...(dto.key !== undefined ? { key: dto.key } : {}),
      ...(dto.id !== undefined ? { id: dto.id } : {}),
    })
  }

  @Patch('admin/:id')
  @ApiOperation({ summary: 'Admin: tắt / bật / đặt lại key' })
  async patch(
    @Param('id') id: string,
    @Body() dto: PatchGroqKeyDto
  ): Promise<{ ok: true }> {
    await this.service.setStatus(id, dto.action)
    return { ok: true }
  }

  @Delete('admin/:id')
  @ApiOperation({ summary: 'Admin: xoá key' })
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.service.remove(id)
    return { ok: true }
  }
}
