import type {
  Contract,
  ContractCommercialDraft,
} from '../schemas/contract.schema'

/** Người ở và đơn giá nằm ở cột của hợp đồng; phụ lục ghi đè qua `effectiveCommercial`. */
export function withContractExtras(
  contract: Contract,
  draft: ContractCommercialDraft
): ContractCommercialDraft {
  return {
    ...(contract.occupants?.length ? { occupants: contract.occupants } : {}),
    ...(contract.utilityRates ? { utilityRates: contract.utilityRates } : {}),
    ...draft,
  }
}

export function resolveEffectiveCommercial(
  contract: Contract
): ContractCommercialDraft {
  if (contract.effectiveCommercial)
    return withContractExtras(contract, contract.effectiveCommercial)
  if (
    (contract.contentLockedAt || contract.contentLockedHash) &&
    contract.commercialDraft
  ) {
    return withContractExtras(contract, contract.commercialDraft)
  }
  return withContractExtras(contract, {
    monthlyRent: contract.monthlyRent,
    deposit: contract.deposit,
    paymentDay: contract.paymentDay,
    latePenaltyRate: contract.latePenaltyRate,
    terminationNoticeDays: contract.terminationNoticeDays,
    durationMonths: contract.durationMonths ?? 12,
    ...(contract.customClauses
      ? { customClauses: contract.customClauses }
      : {}),
  })
}
