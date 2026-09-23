import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import {
  signSmartCaCallback,
  SmartCaCallbackGuard,
  type SmartCaCallbackPayload,
} from './smartca-callback.guard'

describe('SmartCaCallbackGuard', () => {
  const secret = 'callback-secret'
  const payload: SmartCaCallbackPayload = {
    transactionId: 'sca-1',
    status: 'signed',
    artifactHash: 'a'.repeat(64),
    certificateSerial: 'cert-1',
  }

  function context(
    body: unknown,
    headers: Record<string, string>
  ): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ body, headers }) }),
    } as unknown as ExecutionContext
  }

  function guard(): SmartCaCallbackGuard {
    return new SmartCaCallbackGuard({
      get: jest.fn().mockReturnValue(secret),
    } as unknown as ConfigService)
  }

  it('accepts a recent provider-signed callback', () => {
    const timestamp = Date.now().toString()
    const nonce = 'nonce-1'
    const signature = signSmartCaCallback(payload, timestamp, nonce, secret)

    expect(
      guard().canActivate(
        context(payload, {
          'x-smartca-timestamp': timestamp,
          'x-smartca-nonce': nonce,
          'x-smartca-signature': signature,
        })
      )
    ).toBe(true)
  })

  it('rejects forged, expired, malformed, and unconfigured callbacks', () => {
    const timestamp = Date.now().toString()
    const validHeaders = {
      'x-smartca-timestamp': timestamp,
      'x-smartca-nonce': 'nonce-1',
      'x-smartca-signature': 'forged',
    }
    expect(() => guard().canActivate(context(payload, validHeaders))).toThrow(
      UnauthorizedException
    )

    expect(() =>
      guard().canActivate(
        context(payload, {
          ...validHeaders,
          'x-smartca-timestamp': (Date.now() - 6 * 60 * 1000).toString(),
        })
      )
    ).toThrow('SMARTCA_CALLBACK_INVALID')

    expect(() => guard().canActivate(context({}, validHeaders))).toThrow(
      'SMARTCA_CALLBACK_INVALID'
    )

    const unconfigured = new SmartCaCallbackGuard({
      get: jest.fn().mockReturnValue(''),
    } as unknown as ConfigService)
    expect(() =>
      unconfigured.canActivate(context(payload, validHeaders))
    ).toThrow('SMARTCA_CALLBACK_NOT_CONFIGURED')
  })
})
