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

/** Face verification outcome. The embedding returned upstream is never kept. */
export interface EkycFaceResult {
  liveness: boolean
  spoofScore: number
  match: boolean
  distance: number
  threshold: number
}

export const FACE_POSES = ['center', 'left', 'right', 'up'] as const
export type FacePose = (typeof FACE_POSES)[number]

export interface EkycPoseResult {
  faceFound: boolean
  pose: FacePose | null
  matches: boolean
}
