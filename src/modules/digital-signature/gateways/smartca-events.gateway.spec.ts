import { Logger } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { WebSocket } from 'ws'
import { SmartCaEventsGateway } from './smartca-events.gateway'

type MessageHandler = () => void

type GatewayContext = {
  gateway: SmartCaEventsGateway
  jwtService: { verify: jest.Mock }
  sessionRepository: { findOne: jest.Mock }
  socket: FakeSocket
  client: WebSocket
}

class FakeSocket {
  readonly send = jest.fn()
  readonly close = jest.fn()
  readonly ping = jest.fn()
  readonly terminate = jest.fn()
  readonly on = jest.fn((event: string, handler: MessageHandler) => {
    if (event === 'pong') this.pongHandler = handler
  })
  readyState = 1
  private pongHandler?: MessageHandler

  emitPong(): void {
    this.pongHandler?.()
  }
}

describe('SmartCaEventsGateway', () => {
  const contractId = new ObjectId().toHexString()
  const sessionId = new ObjectId().toHexString()
  const token = 'access-token-must-not-be-logged'

  function context(options?: {
    ownerId?: string
    sessionExists?: boolean
  }): GatewayContext {
    const ownerId = options?.ownerId ?? 'tenant-1'
    const sessionRepository = {
      findOne: jest.fn().mockResolvedValue(
        options?.sessionExists === false || ownerId !== 'tenant-1'
          ? null
          : {
              _id: new ObjectId(sessionId),
              contractId,
              signerId: ownerId,
              status: 'pending',
            }
      ),
    }
    const jwtService = {
      verify: jest.fn().mockReturnValue({ _id: 'tenant-1' }),
    }
    const gateway = new SmartCaEventsGateway(
      jwtService as never,
      sessionRepository as never
    )
    const socket = new FakeSocket()

    return {
      gateway,
      jwtService,
      sessionRepository,
      socket,
      client: socket as unknown as WebSocket,
    }
  }

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('closes an unauthenticated connection with 4401 after five seconds', () => {
    const ctx = context()

    ctx.gateway.handleConnection(ctx.client)
    jest.advanceTimersByTime(5_000)

    expect(ctx.socket.close).toHaveBeenCalledWith(4401, 'Unauthorized')
  })

  it('rejects an invalid JWT without logging the token', () => {
    const ctx = context()
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    ctx.jwtService.verify.mockImplementation(() => {
      throw new Error('invalid token')
    })

    ctx.gateway.handleConnection(ctx.client)
    ctx.gateway.handleAuth(ctx.client, { token })

    expect(ctx.socket.close).toHaveBeenCalledWith(4401, 'Unauthorized')
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token)
  })

  it.each([
    { name: 'another participant session', ownerId: 'landlord-1' },
    { name: 'a missing session', sessionExists: false },
  ])('returns the same forbidden error for $name', async options => {
    const ctx = context(options)
    ctx.gateway.handleConnection(ctx.client)
    ctx.gateway.handleAuth(ctx.client, { token })

    await ctx.gateway.handleSubscribe(ctx.client, { contractId, sessionId })

    expect(ctx.socket.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'error',
        data: { code: 'SMARTCA_SUBSCRIPTION_FORBIDDEN' },
      })
    )
  })

  it('limits each authenticated connection to five subscriptions', async () => {
    const ctx = context()
    ctx.gateway.handleConnection(ctx.client)
    ctx.gateway.handleAuth(ctx.client, { token })

    for (let index = 0; index < 6; index += 1) {
      const nextSessionId = new ObjectId().toHexString()
      ctx.sessionRepository.findOne.mockResolvedValueOnce({
        _id: new ObjectId(nextSessionId),
        contractId,
        signerId: 'tenant-1',
        status: 'pending',
      })
      await ctx.gateway.handleSubscribe(ctx.client, {
        contractId,
        sessionId: nextSessionId,
      })
    }

    expect(ctx.socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        event: 'error',
        data: { code: 'SMARTCA_SUBSCRIPTION_LIMIT_REACHED' },
      })
    )
  })

  it('publishes only to the authenticated socket subscribed to the session', async () => {
    const subscribed = context()
    const other = context()
    subscribed.gateway.handleConnection(subscribed.client)
    subscribed.gateway.handleAuth(subscribed.client, { token })
    await subscribed.gateway.handleSubscribe(subscribed.client, {
      contractId,
      sessionId,
    })

    subscribed.gateway.handleConnection(other.client)
    subscribed.gateway.handleAuth(other.client, { token: 'other-token' })
    await subscribed.gateway.publish({
      contractId,
      sessionId,
      status: 'signed',
    })

    expect(subscribed.socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        event: 'smartca.session.updated',
        data: { contractId, sessionId, status: 'signed' },
      })
    )
    expect(other.socket.send).not.toHaveBeenCalled()
  })

  it('removes a disconnected socket from subscriptions', async () => {
    const ctx = context()
    ctx.gateway.handleConnection(ctx.client)
    ctx.gateway.handleAuth(ctx.client, { token })
    await ctx.gateway.handleSubscribe(ctx.client, { contractId, sessionId })

    ctx.gateway.handleDisconnect(ctx.client)
    await ctx.gateway.publish({ contractId, sessionId, status: 'cancelled' })

    expect(ctx.socket.send).toHaveBeenCalledTimes(1)
  })
})
