import { UnprocessableEntityException } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BiometricGrantService } from './biometric-grant.service'

describe('BiometricGrantService', () => {
  const verifiedResult = {
    verified: true,
    faceMatch: true,
    liveness: true,
    realConfidence: 0.92,
  }

  it('can be resolved by the Nest dependency injector', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [BiometricGrantService],
    }).compile()

    expect(moduleRef.get(BiometricGrantService)).toBeInstanceOf(
      BiometricGrantService
    )
  })

  it('issues and consumes a verified grant once', () => {
    const service = new BiometricGrantService()
    service.issue('user-1', verifiedResult)

    expect(service.consume('user-1')).toEqual(verifiedResult)
    expect(() => service.consume('user-1')).toThrow(
      UnprocessableEntityException
    )
  })

  it('does not issue a grant for a failed biometric result', () => {
    const service = new BiometricGrantService()

    service.issue('user-1', { ...verifiedResult, verified: false })

    expect(() => service.consume('user-1')).toThrow(
      UnprocessableEntityException
    )
  })

  it('rejects an expired grant', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T00:00:00Z'))
    const service = new BiometricGrantService()
    service.issue('user-1', verifiedResult)
    jest.setSystemTime(new Date('2026-09-06T00:06:00Z'))

    expect(() => service.consume('user-1')).toThrow(
      UnprocessableEntityException
    )
    jest.useRealTimers()
  })
})
