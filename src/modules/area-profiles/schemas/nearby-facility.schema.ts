export type FacilityType =
  | 'school'
  | 'hospital'
  | 'market'
  | 'bus_stop'
  | 'park'
  | 'gym'
  | 'bank'
  | 'police'
  | 'post_office'
  | 'supermarket'

export interface NearbyFacility {
  type: FacilityType
  name: string
  distanceMeters: number
  travelTimeMinutes?: number
  travelMode?: 'walk' | 'drive'
}
