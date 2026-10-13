import type { IncomingMessage } from 'http'
import { WebSocket } from 'ws'
import { AiConsultationGateway } from './ai-consultation.gateway'
import type { AiConsultationService } from '../services/ai-consultation.service'
import type { GroqLlmService } from '../services/groq-llm.service'
import type { SttService } from '../services/stt.service'
import type { TtsService } from '../services/tts.service'
import type { VadService } from '../services/vad.service'

function createGateway(): {
  gateway: AiConsultationGateway
  client: WebSocket
  closeMock: jest.Mock
  sendMock: jest.Mock
  service: {
    addMessage: jest.Mock
    completeSession: jest.Mock
    checkTransferRules: jest.Mock
  }
  tts: { textToSpeech: jest.Mock }
} {
  const closeMock = jest.fn()
  const sendMock = jest.fn()
  const client = {
    readyState: WebSocket.OPEN,
    close: closeMock,
    send: sendMock,
  } as unknown as WebSocket
  const service = {
    addMessage: jest.fn().mockResolvedValue(undefined),
    completeSession: jest.fn().mockResolvedValue(undefined),
    checkTransferRules: jest.fn().mockReturnValue(false),
  }
  const tts = { textToSpeech: jest.fn().mockResolvedValue('audio') }
  const gateway = new AiConsultationGateway(
    { update: jest.fn() } as never,
    service as unknown as AiConsultationService,
    {
      appendAudio: jest.fn(),
      clearAudio: jest.fn(),
      transcribe: jest.fn(),
    } as unknown as SttService,
    tts as unknown as TtsService,
    {
      processChunk: jest.fn(),
      isSilent: jest.fn(),
      clear: jest.fn(),
      reset: jest.fn(),
    } as unknown as VadService,
    { chat: jest.fn() } as unknown as GroqLlmService
  )
  return { gateway, client, closeMock, sendMock, service, tts }
}

describe('AiConsultationGateway', () => {
  it('rejects connections without a consultation log id', () => {
    const { gateway, client, closeMock } = createGateway()

    gateway.handleConnection(client, {
      url: '/ws/ai-consultation',
    } as IncomingMessage)

    expect(closeMock).toHaveBeenCalledWith(4001, 'logId is required')
  })

  it('greets a valid session and persists the assistant message', async () => {
    const { gateway, client, sendMock, service, tts } = createGateway()

    gateway.handleConnection(client, {
      url: '/ws/ai-consultation?logId=call-1',
    } as IncomingMessage)
    await new Promise(resolve => setImmediate(resolve))

    expect(service.addMessage).toHaveBeenCalledWith(
      'call-1',
      'assistant',
      expect.any(String)
    )
    expect(tts.textToSpeech).toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledWith(
      expect.stringContaining('"event":"chunk"')
    )
  })

  it('completes a session on disconnect and releases audio state', () => {
    const { gateway, client, service } = createGateway()
    gateway.handleConnection(client, {
      url: '/ws/ai-consultation?logId=call-1',
    } as IncomingMessage)

    gateway.handleDisconnect(client)

    expect(service.completeSession).toHaveBeenCalledWith(
      'call-1',
      expect.any(Number)
    )
  })
})
