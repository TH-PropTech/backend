import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common'
import { AiChatsService } from '../services/ai-chats.service'
import { AiChat, ChatMessage } from '../schemas/ai-chat.schema'
import { Public } from '../../../common/decorators/public.decorator'

interface SendMessageBody {
  text?: string
  userId?: string
  deviceId?: string
}

@Controller('ai-chats')
export class AiChatsController {
  constructor(private readonly aiChatsService: AiChatsService) {}

  @Public()
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

  @Public()
  @Post('messages')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Body() body: SendMessageBody
  ): Promise<{ text: string; metadata?: ChatMessage['metadata'] }> {
    const text = body.text?.trim()
    if (!text) throw new BadRequestException('text is required')
    if (!body.userId && !body.deviceId) {
      throw new BadRequestException('Either userId or deviceId is required')
    }
    const sessionKey = {
      ...(body.userId ? { userId: body.userId } : {}),
      ...(body.deviceId ? { deviceId: body.deviceId } : {}),
    }
    const result = await this.aiChatsService.handleUserMessage(sessionKey, text)
    return { text: result.content, metadata: result.metadata }
  }

  @Public()
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
