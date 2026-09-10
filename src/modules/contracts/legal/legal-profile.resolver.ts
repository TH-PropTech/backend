export type LegalProfile =
  | 'PRIVATE_CIVIL_APARTMENT_LEASE'
  | 'REAL_ESTATE_BUSINESS_STANDARD'

export type LegalProfileInput = {
  landlordType: 'individual' | 'business'
  operatesRealEstateBusiness: boolean
}

export function resolveLegalProfile(input: LegalProfileInput): LegalProfile {
  if (input.landlordType === 'business' && input.operatesRealEstateBusiness) {
    return 'REAL_ESTATE_BUSINESS_STANDARD'
  }
  if (
    input.landlordType === 'individual' &&
    !input.operatesRealEstateBusiness
  ) {
    return 'PRIVATE_CIVIL_APARTMENT_LEASE'
  }
  throw new Error('LEGAL_PROFILE_UNRESOLVED')
}
