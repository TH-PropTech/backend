export interface RecommendationContribution {
  finance: number
  location: number
  demographics: number
  amenities: number
}

export interface RecommendationResult {
  id: string
  name: string
  district: string
  rent_price: number
  rooms: number
  has_gym: boolean
  has_parking: boolean
  image_url?: string
  match_score: number
  reasons: string[]
  confidence: 'Cao' | 'Trung bình' | 'Thấp'
  contributions: RecommendationContribution
}

export interface FeedbackResponse {
  status: string
  message: string
  history_records?: number
}

export interface SyncResponse {
  status: string
  message: string
  apartments_loaded: number
}
