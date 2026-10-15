import type { ObjectId } from 'typeorm'
import type { DistrictData } from '../schemas/district-data.schema'
import type { NearbyFacility } from '../schemas/nearby-facility.schema'

/** Hình JSON cũ của AreaProfile (không lộ `kind`). */
export type AreaProfileView = {
  _id: ObjectId
  district: string
  city: string
  ward?: string
  overview: string
  facilities: NearbyFacility[]
  source: string
  disclaimer: string
  lastSurveyedAt: Date
  createdAt: Date
  updatedAt: Date
}

/** Hình JSON cũ của RiskLayerData (không lộ `kind`). */
export type RiskLayerView = {
  _id: ObjectId
  district: string
  layerType: string
  severity: number
  source: string
  timestamp: Date
  confidence: number
  geoJson?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

/** Chỉ giữ khóa có giá trị (khác undefined) để JSON khớp bản ghi cũ. */
function defined<T>(value: object): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T
}

export function toAreaProfileView(row: DistrictData): AreaProfileView {
  return defined<AreaProfileView>({
    _id: row._id,
    district: row.district,
    city: row.city,
    ward: row.ward,
    overview: row.overview,
    facilities: row.facilities,
    source: row.source,
    disclaimer: row.disclaimer,
    lastSurveyedAt: row.lastSurveyedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export function toRiskLayerView(row: DistrictData): RiskLayerView {
  return defined<RiskLayerView>({
    _id: row._id,
    district: row.district,
    layerType: row.layerType,
    severity: row.severity,
    source: row.source,
    timestamp: row.timestamp,
    confidence: row.confidence,
    geoJson: row.geoJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}
