import {
  evaluateConsentDeposit,
  evaluateLockArtifact,
  evaluateLockContent,
  evaluatePayDeposit,
  evaluateSigning,
  isDepositGateOpen,
  type SigningGuardInput,
} from './flow-guards'

describe('evaluateConsentDeposit', () => {
  const metadata = { contentRevision: 1, contentHash: 'hash-1' }

  it('bật khi thỏa thuận ở draft và có revision/hash', () => {
    expect(evaluateConsentDeposit({ status: 'draft', ...metadata })).toEqual({
      enabled: true,
      reasonCode: null,
    })
  })

  it('tắt khi không có thỏa thuận cọc', () => {
    expect(evaluateConsentDeposit(null)).toEqual({
      enabled: false,
      reasonCode: 'DEPOSIT_AGREEMENT_MISSING',
    })
  })

  it('tắt khi thiếu revision hoặc hash', () => {
    expect(
      evaluateConsentDeposit({
        status: 'draft',
        contentRevision: null,
        contentHash: 'hash-1',
      })
    ).toEqual({
      enabled: false,
      reasonCode: 'DEPOSIT_AGREEMENT_METADATA_MISSING',
    })
    expect(
      evaluateConsentDeposit({
        status: 'draft',
        contentRevision: 1,
        contentHash: '',
      })
    ).toEqual({
      enabled: false,
      reasonCode: 'DEPOSIT_AGREEMENT_METADATA_MISSING',
    })
  })

  it.each([
    'accepted',
    'payment-pending',
    'paid',
    'applied-to-lease-security',
    'released',
  ] as const)('tắt với DEPOSIT_CONSENT_ALREADY_GIVEN khi đã %s', status => {
    expect(evaluateConsentDeposit({ status, ...metadata })).toEqual({
      enabled: false,
      reasonCode: 'DEPOSIT_CONSENT_ALREADY_GIVEN',
    })
  })

  it.each(['cancelled', 'expired'] as const)(
    'tắt với DEPOSIT_CONSENT_CLOSED khi thỏa thuận %s',
    status => {
      expect(evaluateConsentDeposit({ status, ...metadata })).toEqual({
        enabled: false,
        reasonCode: 'DEPOSIT_CONSENT_CLOSED',
      })
    }
  )
})

describe('evaluatePayDeposit', () => {
  it.each(['accepted', 'payment-pending'] as const)(
    'bật khi đã đồng ý và thỏa thuận %s',
    status => {
      expect(evaluatePayDeposit({ status, hasConsent: true })).toEqual({
        enabled: true,
        reasonCode: null,
      })
    }
  )

  it('tắt với DEPOSIT_NOT_READY khi chưa đồng ý', () => {
    expect(evaluatePayDeposit({ status: 'draft', hasConsent: false })).toEqual({
      enabled: false,
      reasonCode: 'DEPOSIT_NOT_READY',
    })
    expect(
      evaluatePayDeposit({ status: 'accepted', hasConsent: false })
    ).toEqual({ enabled: false, reasonCode: 'DEPOSIT_NOT_READY' })
  })

  it.each(['paid', 'applied-to-lease-security', 'released'] as const)(
    'tắt với DEPOSIT_ALREADY_PAID khi %s',
    status => {
      expect(evaluatePayDeposit({ status, hasConsent: true })).toEqual({
        enabled: false,
        reasonCode: 'DEPOSIT_ALREADY_PAID',
      })
    }
  )

  it.each(['cancelled', 'expired', 'refunded'] as const)(
    'tắt với DEPOSIT_AGREEMENT_CLOSED khi %s',
    status => {
      expect(evaluatePayDeposit({ status, hasConsent: true })).toEqual({
        enabled: false,
        reasonCode: 'DEPOSIT_AGREEMENT_CLOSED',
      })
    }
  )

  it('tắt với DEPOSIT_AGREEMENT_MISSING khi không có thỏa thuận', () => {
    expect(evaluatePayDeposit(null)).toEqual({
      enabled: false,
      reasonCode: 'DEPOSIT_AGREEMENT_MISSING',
    })
  })
})

describe('evaluateLockContent', () => {
  it.each(['draft', 'deposit-pending', 'deposit-paid', undefined] as const)(
    'bật khi chưa khóa và hợp đồng %s',
    contractStatus => {
      expect(
        evaluateLockContent({ contractStatus, isContentLocked: false })
      ).toEqual({ enabled: true, reasonCode: null })
    }
  )

  it('tắt với CONTENT_ALREADY_LOCKED khi đã khóa', () => {
    expect(
      evaluateLockContent({ contractStatus: 'draft', isContentLocked: true })
    ).toEqual({ enabled: false, reasonCode: 'CONTENT_ALREADY_LOCKED' })
  })

  it.each(['active', 'terminated', 'completed', 'cancelled'] as const)(
    'tắt với CONTRACT_CONTENT_STATE_CLOSED khi hợp đồng %s',
    contractStatus => {
      expect(
        evaluateLockContent({ contractStatus, isContentLocked: false })
      ).toEqual({
        enabled: false,
        reasonCode: 'CONTRACT_CONTENT_STATE_CLOSED',
      })
    }
  )
})

describe('evaluateLockArtifact', () => {
  it('bật khi đã khóa nội dung và chưa có artifact', () => {
    expect(
      evaluateLockArtifact({ isContentLocked: true, hasArtifact: false })
    ).toEqual({ enabled: true, reasonCode: null })
  })

  it('tắt với CONTRACT_CONTENT_NOT_LOCKED khi chưa khóa nội dung', () => {
    expect(
      evaluateLockArtifact({ isContentLocked: false, hasArtifact: false })
    ).toEqual({ enabled: false, reasonCode: 'CONTRACT_CONTENT_NOT_LOCKED' })
  })

  it('tắt với ARTIFACT_ALREADY_LOCKED khi đã có artifact', () => {
    expect(
      evaluateLockArtifact({ isContentLocked: true, hasArtifact: true })
    ).toEqual({ enabled: false, reasonCode: 'ARTIFACT_ALREADY_LOCKED' })
  })
})

describe('isDepositGateOpen', () => {
  it('SIGN_FIRST luôn mở cổng cọc trước khi ký', () => {
    expect(isDepositGateOpen('SIGN_FIRST', false)).toBe(true)
  })

  it('DEPOSIT_FIRST chỉ mở khi cọc đã xác nhận', () => {
    expect(isDepositGateOpen('DEPOSIT_FIRST', false)).toBe(false)
    expect(isDepositGateOpen('DEPOSIT_FIRST', true)).toBe(true)
  })
})

describe('evaluateSigning', () => {
  const eligible: SigningGuardInput = {
    isParticipant: true,
    hasSigned: false,
    isConfigOutdated: false,
    isContentLocked: true,
    requiresArtifact: false,
    hasArtifact: false,
    contractStatus: 'awaiting-signature',
    strategy: 'DEPOSIT_FIRST',
    isDepositConfirmed: true,
    isKycVerified: true,
  }

  it('đủ điều kiện khi mọi cổng đều mở', () => {
    expect(evaluateSigning(eligible)).toEqual({
      eligible: true,
      reasonCode: null,
      message: null,
    })
  })

  it.each([
    [{ isParticipant: false }, 'NOT_PARTICIPANT'],
    [{ hasSigned: true }, 'ALREADY_SIGNED'],
    [{ isConfigOutdated: true }, 'CONFIG_OUTDATED'],
    [{ isContentLocked: false }, 'CONTENT_NOT_LOCKED'],
    [{ requiresArtifact: true, hasArtifact: false }, 'ARTIFACT_NOT_LOCKED'],
    [{ contractStatus: 'draft' }, 'WRONG_STATE'],
    [{ isDepositConfirmed: false }, 'DEPOSIT_REQUIRED'],
    [{ isKycVerified: false }, 'KYC_NOT_VERIFIED'],
  ] as const)('chặn với %j → %s', (override, reasonCode) => {
    const result = evaluateSigning({ ...eligible, ...override })
    expect(result.eligible).toBe(false)
    expect(result.reasonCode).toBe(reasonCode)
    expect(result.message).toEqual(expect.any(String))
  })

  it('SmartCA đã khóa artifact thì không chặn ARTIFACT_NOT_LOCKED', () => {
    expect(
      evaluateSigning({
        ...eligible,
        requiresArtifact: true,
        hasArtifact: true,
      }).eligible
    ).toBe(true)
  })

  it('SIGN_FIRST cho ký khi cọc chưa xác nhận', () => {
    expect(
      evaluateSigning({
        ...eligible,
        strategy: 'SIGN_FIRST',
        isDepositConfirmed: false,
      }).eligible
    ).toBe(true)
  })

  it('giữ thứ tự ưu tiên: chưa khóa nội dung được báo trước thiếu KYC', () => {
    expect(
      evaluateSigning({
        ...eligible,
        isContentLocked: false,
        isKycVerified: false,
      }).reasonCode
    ).toBe('CONTENT_NOT_LOCKED')
  })
})
