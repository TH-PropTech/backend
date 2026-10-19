/**
 * Type definitions for the Naive Bayes recommendation engine.
 *
 * These interfaces mirror the data structures used by the Python
 * `ApartmentRecommender` (recommender.py) — ported to TypeScript.
 */

export type EngineStrategy = 'hybrid' | 'map' | 'weighted' | 'map-weighted'

export interface EngineConfig {
  strategy: EngineStrategy
  alpha: number
  nbWeight: number
  ruleWeight: number
}

/** A flattened apartment record used by the NB model. */
export interface ApartmentRecord {
  id: string
  name: string
  district: string
  rent_price: number
  min_income: number
  target_age_min: number
  target_age_max: number
  rooms: number
  has_gym: number // 0 | 1
  has_parking: number // 0 | 1
  image_url: string
}

/** A single training record from rental history. */
export interface TrainingRecord {
  user_age: number
  user_income: number
  preferred_district: string
  preferred_bedrooms: number
  requires_gym: number // 0 | 1
  requires_parking: number // 0 | 1
  rented_apartment_id: string
}

/** Gaussian (mean, variance) for a continuous feature. */
export interface GaussianStats {
  mean: number
  var: number
}

/** Frequency counts for a categorical feature with Laplace smoothing. */
export interface CategoricalStats {
  counts: Record<string, number>
  total: number
}

/** Per-apartment trained parameters. */
export interface ApartmentModelParams {
  prior: number
  gaussian: {
    age: GaussianStats
    income: GaussianStats
  }
  categorical: {
    district: CategoricalStats
    rooms: CategoricalStats
    gym: CategoricalStats
    parking: CategoricalStats
  }
}

/** User profile input for the recommendation engine. */
export interface UserProfile {
  age: number
  income: number
  preferred_district: string
  rooms: number
  has_gym: boolean
  has_parking: boolean
}

/** Per-pillar contribution percentages in a recommendation. */
export interface RecommendationContributions {
  finance: number
  location: number
  demographics: number
  amenities: number
}

/** A single recommendation result. */
export interface RecommendationOutput {
  id: string
  name: string
  district: string
  rent_price: number
  rooms: number
  has_gym: boolean
  has_parking: boolean
  image_url: string
  match_score: number
  reasons: string[]
  confidence: 'Cao' | 'Trung bình' | 'Thấp'
  contributions: RecommendationContributions
}
