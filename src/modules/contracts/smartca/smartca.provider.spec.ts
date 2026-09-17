import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { SmartCaProvider } from './smartca.provider'

describe('SmartCaProvider', () => {
  const input = {
    transactionId: 'sca-tx-1',
    artifactHash: 'a'.repeat(64),
    signerId: '012345678901',
    signerRole: 'tenant' as const,
  }

  afterEach(() => jest.restoreAllMocks())

  it('fails closed when VNPT credentials are not configured', async () => {
    const config = { get: jest.fn().mockReturnValue({}) }
    const provider = new SmartCaProvider(config as unknown as ConfigService)
    await expect(provider.requestSignature(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException
    )
  })

  it('normalizes a successful provider response without leaking credentials', async () => {
    const config = {
      get: jest.fn().mockReturnValue({
        apiUrl: 'https://smartca.test',
        spId: 'partner',
        spPassword: 'secret',
        mobileCode: '0900000000',
        signV2Path: '/sign',
      }),
    }
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ transaction_id: 'sca-tx-2', status: 'PENDING' }),
    } as unknown as Response)
    const provider = new SmartCaProvider(config as unknown as ConfigService)

    await expect(provider.requestSignature(input)).resolves.toEqual({
      transactionId: 'sca-tx-2',
      status: 'pending',
    })
    const call = fetchMock.mock.calls[0] as unknown[]
    const requestInit = call[1] as { method?: string; body?: string }
    expect(call[0]).toBe('https://smartca.test/sign')
    expect(requestInit.method).toBe('POST')
    expect(requestInit.body).toContain('sca-tx-1')
  })

  it('maps provider failures and malformed responses to typed errors', async () => {
    const config = {
      get: jest.fn().mockReturnValue({
        apiUrl: 'https://smartca.test',
        spId: 'partner',
        spPassword: 'secret',
        signV2Path: '/sign',
      }),
    }
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    } as unknown as Response)
    const provider = new SmartCaProvider(config as unknown as ConfigService)
    await expect(provider.requestSignature(input)).rejects.toBeInstanceOf(
      BadGatewayException
    )

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('bad json')),
    } as unknown as Response)
    await expect(provider.requestSignature(input)).rejects.toBeInstanceOf(
      BadGatewayException
    )
  })

  it('maps transport timeouts and signed responses without certificate evidence', async () => {
    const config = {
      get: jest.fn().mockReturnValue({
        apiUrl: 'https://smartca.test',
        spId: 'partner',
        spPassword: 'secret',
        signV2Path: '/sign',
      }),
    }
    const provider = new SmartCaProvider(config as unknown as ConfigService)

    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'))
    await expect(provider.requestSignature(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException
    )

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ transaction_id: 'sca-tx-3', status: 'SIGNED' }),
    } as unknown as Response)
    await expect(provider.requestSignature(input)).rejects.toBeInstanceOf(
      BadGatewayException
    )
  })
})
