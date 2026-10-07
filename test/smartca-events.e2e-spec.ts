import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { WsAdapter } from '@nestjs/platform-ws'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Test } from '@nestjs/testing'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { WebSocket } from 'ws'
import { SmartCaEventsGateway } from '../src/modules/contracts/smartca/smartca-events.gateway'
import { SmartCaSigningSession } from '../src/modules/contracts/smartca/smartca-signing-session.schema'

describe('SmartCA realtime gateway (e2e)', () => {
  let app: INestApplication

  afterEach(async () => {
    await app?.close()
  })

  it('accepts an authenticated raw WebSocket subscription through WsAdapter', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SmartCaEventsGateway,
        {
          provide: JwtService,
          useValue: { verify: jest.fn().mockReturnValue({ _id: 'tenant-1' }) },
        },
        {
          provide: getRepositoryToken(SmartCaSigningSession),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              contractId: 'contract-1',
              signerId: 'tenant-1',
              status: 'pending',
            }),
          },
        },
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    app.useWebSocketAdapter(new WsAdapter(app))
    await app.listen(0, '127.0.0.1')
    const address = (app.getHttpServer() as Server).address() as AddressInfo
    const client = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws/contracts/smartca`
    )

    const response = await new Promise<string>((resolve, reject) => {
      client.once('error', reject)
      client.once('open', () => {
        client.send(
          JSON.stringify({ event: 'auth', data: { token: 'valid-token' } })
        )
        client.send(
          JSON.stringify({
            event: 'subscribe',
            data: {
              contractId: 'contract-1',
              sessionId: '507f1f77bcf86cd799439011',
            },
          })
        )
      })
      client.once('message', data => resolve((data as Buffer).toString()))
    })

    expect(JSON.parse(response)).toEqual({
      event: 'subscribed',
      data: { sessionId: '507f1f77bcf86cd799439011' },
    })
    client.close()
  })
})
