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
    const sessionKey = {
      ...(userId ? { userId } : {}),
      ...(deviceId ? { deviceId } : {}),
    }
    return this.aiChatsService.getOrCreateSession(sessionKey)
  }

  @Delete('history')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearHistory(
    @Query('userId') userId?: string,
    @Query('deviceId') deviceId?: string
  ): Promise<void> {
    const sessionKey = {
      ...(userId ? { userId } : {}),
      ...(deviceId ? { deviceId } : {}),
    }
    await this.aiChatsService.clearHistory(sessionKey)
  }
}
