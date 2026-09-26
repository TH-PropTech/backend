export type LegalProfile =
  | 'PRIVATE_CIVIL_APARTMENT_LEASE'
  | 'REAL_ESTATE_BUSINESS_STANDARD'

export type LegalProfileInput = {
  landlordType: 'individual' | 'business'
  operatesRealEstateBusiness: boolean
  verified?: boolean
  transactionType?: 'civil' | 'real-estate-business'
}

export function resolveLegalProfile(input: LegalProfileInput): LegalProfile {
  if (input.verified === false) throw new Error('LEGAL_PROFILE_UNRESOLVED')
  if (
    input.transactionType === 'real-estate-business' &&
    input.landlordType === 'business' &&
    input.operatesRealEstateBusiness
  ) {
    return 'REAL_ESTATE_BUSINESS_STANDARD'
  }
  if (
    input.transactionType === 'civil' &&
    input.landlordType === 'individual' &&
    !input.operatesRealEstateBusiness
  ) {
    return 'PRIVATE_CIVIL_APARTMENT_LEASE'
  }
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
