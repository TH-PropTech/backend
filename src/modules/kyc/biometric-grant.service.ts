import { Injectable, UnprocessableEntityException } from '@nestjs/common'

import type { EkycBiometricResult } from './ekyc-proxy.service'

const DEFAULT_GRANT_TTL_MS = 5 * 60 * 1000

interface BiometricGrant {
  readonly expiresAt: number
  readonly result: EkycBiometricResult
}

@Injectable()
export class BiometricGrantService {
  private readonly grants = new Map<string, BiometricGrant>()
  private readonly ttlMs = DEFAULT_GRANT_TTL_MS

  constructor() {}

  issue(userId: string, result: EkycBiometricResult): void {
    if (!result.verified) {
      this.grants.delete(userId)
      return
    }
    this.grants.set(userId, {
      result,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  consume(userId: string): EkycBiometricResult {
    const grant = this.grants.get(userId)
    this.grants.delete(userId)
    if (!grant || grant.expiresAt <= Date.now()) {
      throw new UnprocessableEntityException(
        'Phiên xác minh sinh trắc học không tồn tại hoặc đã hết hạn'
      )
    }
    return grant.result
  }
}
