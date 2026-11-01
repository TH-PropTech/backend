export interface EkycOcrFrontResult {
  idNumber: string
  fullName: string
  dob: string
  gender: string
  nationality: string
  birthplace?: string
  address?: string
}

export interface EkycOcrBackResult {
  success: boolean
  version?: string
  data?: {
    address?: string
    issueDate?: string
    expiryDate?: string
    placeOfBirth?: string
  }
}
