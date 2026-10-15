import type { ObjectId } from 'typeorm'
import type { EngineStrategy } from '../recommendations/engine/naive-bayes.types'
import type { SystemConfig } from '../schemas/system-config.schema'

/** Khóa (`SystemConfig.key`) của cấu hình engine gợi ý toàn hệ thống. */
export const RECOMMENDATION_CONFIG_KEY = 'global'

/**
 * Hình dạng API `GET/PUT recommendations/engine-config`: giữ nguyên như entity
 * `RecommendationConfig` cũ (`configId`, không có `scope`/`key`/`createdAt`).
 */
export interface RecommendationConfigView {
  _id: ObjectId
  configId: string
  strategy: EngineStrategy
  alpha: number
  nbWeight: number
  ruleWeight: number
  updatedAt: Date
  updatedBy?: string
}

/** Ánh xạ bản ghi `SystemConfig{scope:'recommendation'}` về hình API cũ. */
export function toRecommendationConfigView(
  row: SystemConfig
): RecommendationConfigView {
  const view: RecommendationConfigView = {
    _id: row._id,
    configId: row.key,
    strategy: row.strategy ?? 'hybrid',
    alpha: row.alpha ?? 1.0,
    nbWeight: row.nbWeight ?? 0.5,
    ruleWeight: row.ruleWeight ?? 0.5,
    updatedAt: row.updatedAt,
  }
  if (row.updatedBy !== undefined && row.updatedBy !== null) {
    view.updatedBy = row.updatedBy
  }
  return view
}
