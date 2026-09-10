export type DepositPurpose =
  | 'SECURE_CONCLUSION'
  | 'SECURE_PERFORMANCE'
  | 'SECURE_CONCLUSION_THEN_PERFORMANCE'

export type DepositOutcome =
  | 'apply-to-security'
  | 'refund'
  | 'forfeit'
  | 'dispute'

export function validateDepositDisposition(
  purpose: DepositPurpose,
  outcome: DepositOutcome
): true {
  const allowed: Record<DepositPurpose, DepositOutcome[]> = {
    SECURE_CONCLUSION: ['apply-to-security', 'refund', 'dispute'],
    SECURE_PERFORMANCE: ['apply-to-security', 'refund', 'forfeit', 'dispute'],
    SECURE_CONCLUSION_THEN_PERFORMANCE: [
      'apply-to-security',
      'refund',
      'forfeit',
      'dispute',
    ],
  }
  if (!allowed[purpose].includes(outcome))
    throw new Error('DEPOSIT_OUTCOME_NOT_ALLOWED')
  return true
}
