import {
  Controller,
  Get,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { AiChatsService } from './services/ai-chats.service'
import { AiChat } from './schemas/ai-chat.schema'

@Controller('ai-chats')
export class AiChatsController {
  constructor(private readonly aiChatsService: AiChatsService) {}

  @Get('history')
  async getHistory(
    @Query('userId') userId?: string,
    @Query('deviceId') deviceId?: string
  ): Promise<AiChat> {
    return this.aiChatsService.getOrCreateSession({ userId, deviceId })
  }

  @Delete('history')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearHistory(
    @Query('userId') userId?: string,
    @Query('deviceId') deviceId?: string
  ): Promise<void> {
    await this.aiChatsService.clearHistory({ userId, deviceId })
  }
}
