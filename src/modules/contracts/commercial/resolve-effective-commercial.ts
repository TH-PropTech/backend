import type {
  Contract,
  ContractCommercialDraft,
} from '../schemas/contract.schema'

export function resolveEffectiveCommercial(
  contract: Contract
): ContractCommercialDraft {
  if (contract.effectiveCommercial) return contract.effectiveCommercial
  if (
    (contract.contentLockedAt || contract.contentLockedHash) &&
    contract.commercialDraft
  ) {
    return contract.commercialDraft
  }
  return {
    monthlyRent: contract.monthlyRent,
    deposit: contract.deposit,
    paymentDay: contract.paymentDay,
    latePenaltyRate: contract.latePenaltyRate,
    terminationNoticeDays: contract.terminationNoticeDays,
    durationMonths: contract.durationMonths ?? 12,
  }
}
