import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
  Res,
} from '@nestjs/common'
import { IsString, IsOptional, IsNumber } from 'class-validator'
import { Response } from 'express'
import { AiConsultationService } from './services/ai-consultation.service'
import { AiConsultationLog } from './schemas/ai-consultation-log.schema'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { getChatViewHtml } from './templates/chat-view.template'

export class StartSessionDto {
  @IsString()
  @IsOptional()
  userId?: string
}

export class WebCompleteDto {
  @IsString()
  logId!: string

  @IsNumber()
  duration!: number
}

@Controller('ai-consultation')
export class AiConsultationController {
  constructor(private readonly consultationService: AiConsultationService) {}

  @Post('start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  async start(@Body() dto: StartSessionDto): Promise<AiConsultationLog> {
    return this.consultationService.startSession(dto.userId)
  }

  @Get('logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  async getLogs(): Promise<AiConsultationLog[]> {
    return this.consultationService.getLogs()
  }

  @Post('logs/web-complete')
  @HttpCode(HttpStatus.OK)
  async webComplete(
    @Body() dto: WebCompleteDto
  ): Promise<{ success: boolean }> {
    await this.consultationService.completeSession(dto.logId, dto.duration)
    return { success: true }
  }

  @Get('chat-view')
  getChatView(@Query('logId') logId: string, @Res() res: Response): void {
    const html = getChatViewHtml(logId)
    res.type('html').send(html)
  }
}
