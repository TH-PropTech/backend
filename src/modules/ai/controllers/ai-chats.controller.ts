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
import { Throttle } from '@nestjs/throttler'
import { AiChatsService } from '../services/ai-chats.service'
import { AiChat, ChatMessage } from '../schemas/ai-chat.schema'
import type { GroqErrorCode } from '../services/groq-agent.service'
import { Public } from '../../../common/decorators/public.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import {
  DEVICE_ID_PATTERN,
  SendAiChatMessageDto,
} from '../dto/send-ai-chat-message.dto'

/** Chat calls Groq (shared org-level token budget), so it gets a tighter limit than the global one. */
const CHAT_THROTTLE = { default: { limit: 20, ttl: 60_000 } }

interface SessionKey {
  userId?: string
  deviceId?: string
}

/**
 * Identity comes only from the JWT (the global guard fills `request.user` on @Public routes when a valid
 * token is sent). A guest is identified by `deviceId` alone; a `userId` supplied by the client is never used.
 */
function resolveSessionKey(
  authUserId: unknown,
  deviceId: string | undefined
): SessionKey {
  if (authUserId) {
    return { userId: (authUserId as { toString(): string }).toString() }
  }
  if (deviceId && DEVICE_ID_PATTERN.test(deviceId)) return { deviceId }
  throw new BadRequestException('Cần đăng nhập hoặc cung cấp deviceId hợp lệ')
}

@Controller('ai-chats')
export class AiChatsController {
  constructor(private readonly aiChatsService: AiChatsService) {}

  @Public()
  @Get('history')
  async getHistory(
    @CurrentUser('id') authUserId: unknown,
    @Query('deviceId') deviceId?: string
  ): Promise<AiChat> {
    return this.aiChatsService.getOrCreateSession(
      resolveSessionKey(authUserId, deviceId)
    )
  }

  @Public()
  @Throttle(CHAT_THROTTLE)
  @Post('messages')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @CurrentUser('id') authUserId: unknown,
    @Body() body: SendAiChatMessageDto
  ): Promise<{
    text: string
    metadata?: ChatMessage['metadata']
    errorCode?: GroqErrorCode
  }> {
    const sessionKey = resolveSessionKey(authUserId, body.deviceId)
    const result = await this.aiChatsService.handleUserMessage(
      sessionKey,
      body.text
    )
    return {
      text: result.content,
      metadata: result.metadata,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    }
  }

  @Public()
  @Delete('history')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearHistory(
    @CurrentUser('id') authUserId: unknown,
    @Query('deviceId') deviceId?: string
  ): Promise<void> {
    await this.aiChatsService.clearHistory(
      resolveSessionKey(authUserId, deviceId)
    )
  }
}
