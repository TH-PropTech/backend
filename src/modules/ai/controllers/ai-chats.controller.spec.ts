import 'reflect-metadata'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { AiChatsController } from './ai-chats.controller'
import { SendAiChatMessageDto } from '../dto/send-ai-chat-message.dto'
import type { AiChatsService } from '../services/ai-chats.service'

function build(): {
  controller: AiChatsController
  service: {
    getOrCreateSession: Mock
    handleUserMessage: Mock
    clearHistory: Mock
  }
} {
  const service = {
    getOrCreateSession: vi.fn().mockResolvedValue({ messages: [] }),
    handleUserMessage: vi
      .fn()
      .mockResolvedValue({ content: 'Chào bạn', metadata: undefined }),
    clearHistory: vi.fn().mockResolvedValue(undefined),
  }
  const controller = new AiChatsController(service as unknown as AiChatsService)
  return { controller, service }
}

const dto = (body: Record<string, unknown>): SendAiChatMessageDto =>
  plainToInstance(SendAiChatMessageDto, body)

describe('AiChatsController identity', () => {
  it('uses the JWT user and ignores a userId sent by the client', async () => {
    const { controller, service } = build()
    await controller.sendMessage(
      'user-real',
      dto({
        text: 'Xin chào',
        userId: 'victim',
        deviceId: 'web-device-abc12345',
      })
    )
    expect(service.handleUserMessage).toHaveBeenCalledWith(
      { userId: 'user-real' },
      'Xin chào'
    )
  })

  it('serves a guest by deviceId only', async () => {
    const { controller, service } = build()
    await controller.getHistory(null, 'web-device-abc12345')
    expect(service.getOrCreateSession).toHaveBeenCalledWith({
      deviceId: 'web-device-abc12345',
    })
  })

  it('refuses to read or clear history without a JWT or a deviceId', async () => {
    const { controller, service } = build()
    await expect(controller.getHistory(null, undefined)).rejects.toBeInstanceOf(
      BadRequestException
    )
    await expect(
      controller.clearHistory(null, undefined)
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(service.getOrCreateSession).not.toHaveBeenCalled()
    expect(service.clearHistory).not.toHaveBeenCalled()
  })

  it('rejects a malformed deviceId', async () => {
    const { controller } = build()
    await expect(
      controller.getHistory(null, 'a b/../c')
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('returns the error code of a failed answer', async () => {
    const { controller, service } = build()
    service.handleUserMessage.mockResolvedValueOnce({
      content: 'quá tải',
      errorCode: 'quota',
    })
    const result = await controller.sendMessage(
      null,
      dto({ text: 'Xin chào', deviceId: 'web-device-abc12345' })
    )
    expect(result.errorCode).toBe('quota')
  })
})

describe('SendAiChatMessageDto', () => {
  it('accepts a normal message and trims it', async () => {
    const body = dto({ text: '  Xin chào  ', deviceId: 'web-device-abc12345' })
    expect(await validate(body)).toHaveLength(0)
    expect(body.text).toBe('Xin chào')
  })

  it('rejects empty and over-long text', async () => {
    expect((await validate(dto({ text: '   ' }))).length).toBeGreaterThan(0)
    expect(
      (await validate(dto({ text: 'a'.repeat(2001) }))).length
    ).toBeGreaterThan(0)
  })

  it('still accepts the legacy userId field so old clients do not get a 400', async () => {
    expect(await validate(dto({ text: 'Hi', userId: 'abc' }))).toHaveLength(0)
  })
})
