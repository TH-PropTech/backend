import { ConflictException } from '@nestjs/common'

export type DepositAgreementConsentState = {
  status:
    | 'draft'
    | 'accepted'
    | 'payment-pending'
    | 'paid'
    | 'applied-to-lease-security'
    | 'cancelled'
    | 'expired'
  contentRevision: number
  contentHash: string
}

export type DepositConsentInput = {
  expectedRevision: number
  expectedContentHash: string
}

export function validateDepositConsent(
  agreement: DepositAgreementConsentState,
  input: DepositConsentInput
): true {
  const valid =
    agreement.status === 'accepted' &&
    agreement.contentRevision === input.expectedRevision &&
    agreement.contentHash === input.expectedContentHash
  if (!valid) throw new ConflictException('DEPOSIT_CONSENT_REQUIRED')
  return true
}
